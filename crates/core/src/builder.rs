use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Aggregate {
    Count,
    Sum,
    Average,
    Minimum,
    Maximum,
    Distinct,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Grain {
    Day,
    Week,
    Month,
    Quarter,
    Year,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuerySpec {
    pub table: String,
    pub aggregate: Aggregate,
    pub measure: Option<String>,
    pub by: Option<String>,
    pub grain: Option<Grain>,
    #[serde(default)]
    pub series: Option<String>,
    pub trend_by: Option<String>,
    pub trend_grain: Option<Grain>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltQuery {
    pub sql: String,
    pub trend_sql: Option<String>,
    pub x_column: Option<String>,
    pub y_column: String,
    pub series_column: Option<String>,
}

fn name(text: &str) -> String {
    format!("\"{}\"", text.replace('"', "\"\""))
}

fn measure_sql(spec: &QuerySpec) -> String {
    let column = spec.measure.as_deref().map_or("*".to_owned(), name);
    match spec.aggregate {
        Aggregate::Count => "count(*)".to_owned(),
        Aggregate::Sum => format!("sum({column})"),
        Aggregate::Average => format!("avg({column})"),
        Aggregate::Minimum => format!("min({column})"),
        Aggregate::Maximum => format!("max({column})"),
        Aggregate::Distinct => format!("count(DISTINCT {column})"),
    }
}

fn measure_label(spec: &QuerySpec) -> String {
    let column = spec.measure.as_deref().unwrap_or("rows");
    match spec.aggregate {
        Aggregate::Count => "Rows".to_owned(),
        Aggregate::Sum => format!("Total {column}"),
        Aggregate::Average => format!("Average {column}"),
        Aggregate::Minimum => format!("Lowest {column}"),
        Aggregate::Maximum => format!("Highest {column}"),
        Aggregate::Distinct => format!("Unique {column}"),
    }
}

fn period(column: &str, grain: Option<Grain>) -> String {
    let date = format!("{}::TIMESTAMP", name(column));
    let truncated =
        |unit: &str, format: &str| format!("strftime(date_trunc('{unit}', {date}), '{format}')");
    match grain {
        None => name(column),
        Some(Grain::Day) => truncated("day", "%Y-%m-%d"),
        Some(Grain::Week) => truncated("week", "%Y-%m-%d"),
        Some(Grain::Month) => truncated("month", "%Y-%m"),
        Some(Grain::Quarter) => format!("year({date}) || '-Q' || quarter({date})"),
        Some(Grain::Year) => truncated("year", "%Y"),
    }
}

// Column names are quoted here and tables come from the project, and every
// query still passes the same read-only check as one the AI writes.
pub fn build_query(spec: &QuerySpec, table: &str) -> BuiltQuery {
    let from = name(table);
    let measure = measure_sql(spec);
    let label = measure_label(spec);
    let alias = name(&label);
    let sql = match &spec.by {
        None => format!("SELECT {measure} AS {alias} FROM {from}"),
        Some(by) => {
            let (series, group, order) = match (&spec.series, spec.grain) {
                (Some(series), _) => (format!("{}, ", name(series)), "1, 2", "1, 2"),
                (None, Some(_)) => (String::new(), "1", "1"),
                (None, None) => (String::new(), "1", "2 DESC"),
            };
            format!(
                "SELECT {} AS {}, {series}{measure} AS {alias} FROM {from} \
                 WHERE {} IS NOT NULL GROUP BY {group} ORDER BY {order}",
                period(by, spec.grain),
                name(by),
                name(by)
            )
        }
    };
    let trend_sql = spec.trend_by.as_ref().map(|by| {
        format!(
            "SELECT {} AS period, {measure} AS value FROM {from} \
             WHERE {} IS NOT NULL GROUP BY 1 ORDER BY 1",
            period(by, spec.trend_grain),
            name(by)
        )
    });
    BuiltQuery {
        sql,
        trend_sql,
        x_column: spec.by.clone(),
        y_column: label,
        series_column: spec.series.clone(),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Arc;

    use super::*;
    use crate::{QueryResult, QueryTable, open_table, run_query};

    const SALES: &str = "day,region,amount\n2026-01-05,EMEA,10\n2026-01-20,EMEA,5\n2026-02-03,APAC,20\n2026-03-09,APAC,1\n";

    fn spec() -> QuerySpec {
        QuerySpec {
            table: "sales.csv".to_owned(),
            aggregate: Aggregate::Sum,
            measure: Some("amount".to_owned()),
            by: None,
            grain: None,
            series: None,
            trend_by: None,
            trend_grain: None,
        }
    }

    fn run(name: &str, sql: &str) -> QueryResult {
        let folder =
            std::env::temp_dir().join(format!("davis-builder-{}-{name}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join("sales.csv");
        fs::write(&path, SALES).unwrap();
        let table = QueryTable::new("sales", open_table(&path.to_string_lossy()).unwrap().source);
        let result = run_query(&[table], sql, Arc::default()).unwrap();
        fs::remove_dir_all(&folder).unwrap();
        result
    }

    fn cells(result: &QueryResult) -> Vec<Vec<&str>> {
        result
            .rows
            .iter()
            .map(|row| row.iter().map(|cell| cell.as_deref().unwrap()).collect())
            .collect()
    }

    #[test]
    fn a_single_number_needs_no_breakdown() {
        let built = build_query(&spec(), "sales");

        assert_eq!(built.y_column, "Total amount");
        assert_eq!(built.x_column, None);
        assert_eq!(cells(&run("total", &built.sql)), [["36"]]);
    }

    #[test]
    fn a_breakdown_comes_largest_first() {
        let built = build_query(
            &QuerySpec {
                by: Some("region".to_owned()),
                ..spec()
            },
            "sales",
        );

        assert_eq!(built.x_column.as_deref(), Some("region"));
        assert_eq!(
            cells(&run("region", &built.sql)),
            [["APAC", "21"], ["EMEA", "15"]]
        );
    }

    #[test]
    fn dates_group_by_period_in_time_order() {
        let built = build_query(
            &QuerySpec {
                by: Some("day".to_owned()),
                grain: Some(Grain::Month),
                ..spec()
            },
            "sales",
        );

        assert_eq!(
            cells(&run("months", &built.sql)),
            [["2026-01", "15"], ["2026-02", "20"], ["2026-03", "1"]]
        );
    }

    #[test]
    fn quarters_read_as_quarters() {
        let built = build_query(
            &QuerySpec {
                by: Some("day".to_owned()),
                grain: Some(Grain::Quarter),
                ..spec()
            },
            "sales",
        );

        assert_eq!(cells(&run("quarters", &built.sql)), [["2026-Q1", "36"]]);
    }

    #[test]
    fn counting_rows_and_unique_values_need_no_sum() {
        let rows = QuerySpec {
            aggregate: Aggregate::Count,
            measure: None,
            ..spec()
        };
        let unique = QuerySpec {
            aggregate: Aggregate::Distinct,
            measure: Some("region".to_owned()),
            ..spec()
        };

        assert_eq!(
            cells(&run("rows", &build_query(&rows, "sales").sql)),
            [["4"]]
        );
        assert_eq!(
            cells(&run("unique", &build_query(&unique, "sales").sql)),
            [["2"]]
        );
    }

    #[test]
    fn a_number_can_carry_its_trend() {
        let built = build_query(
            &QuerySpec {
                trend_by: Some("day".to_owned()),
                trend_grain: Some(Grain::Month),
                ..spec()
            },
            "sales",
        );

        assert_eq!(
            cells(&run("trend", &built.trend_sql.unwrap())),
            [["2026-01", "15"], ["2026-02", "20"], ["2026-03", "1"]]
        );
    }

    #[test]
    fn a_series_splits_each_bar() {
        let built = build_query(
            &QuerySpec {
                by: Some("day".to_owned()),
                grain: Some(Grain::Month),
                series: Some("region".to_owned()),
                ..spec()
            },
            "sales",
        );

        assert_eq!(built.series_column.as_deref(), Some("region"));
        assert_eq!(
            cells(&run("series", &built.sql)),
            [
                ["2026-01", "EMEA", "15"],
                ["2026-02", "APAC", "20"],
                ["2026-03", "APAC", "1"]
            ]
        );
    }

    #[test]
    fn a_strange_column_name_cannot_break_the_query() {
        let built = build_query(
            &QuerySpec {
                measure: Some("a\"; DROP TABLE x; --".to_owned()),
                ..spec()
            },
            "sales",
        );

        assert!(built.sql.contains("\"a\"\"; DROP TABLE x; --\""));
    }
}
