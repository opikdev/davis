use davis_core::{
    Aggregate, BuiltQuery, ColumnKind, ColumnProfile, Grain, QuerySpec, TableLink,
    build_linked_query, build_query, column_values,
};
use davis_project::{Block, BlockKind, FilterKind, Page, PageFilter, place_block};
use serde::Deserialize;

use crate::prompt::ProjectTable;

const MAX_GROUPS: u64 = 30;
const MAX_DRAFT_GROUPS: usize = 3;
const MAX_COMMON_SHARE: f64 = 0.9;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DraftKind {
    Overview,
    Trends,
    Compare,
    Report,
}

pub struct DraftSource<'a> {
    pub table: &'a ProjectTable,
    pub profile: Vec<ColumnProfile>,
}

fn is_identifier(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower == "id" || lower.ends_with("_id") || lower.ends_with(" id") || name.ends_with("ID")
}

// A whole-number column named like a year, such as `Year` or `fiscal_year`.
fn looks_like_year(column: &ColumnProfile) -> bool {
    let is_year = |value: &Option<String>| {
        value
            .as_deref()
            .and_then(|value| value.parse::<i64>().ok())
            .is_some_and(|year| (1000..=2999).contains(&year))
    };
    column.kind == ColumnKind::Number
        && column.name.to_lowercase().contains("year")
        && is_year(&column.min)
        && is_year(&column.max)
}

// Adding up rates, shares or temperatures gives a meaningless total.
fn is_average_only(column: &ColumnProfile) -> bool {
    const WORDS: [&str; 15] = [
        "average",
        "avg",
        "mean",
        "median",
        "rate",
        "ratio",
        "share",
        "percent",
        "percentage",
        "pct",
        "capita",
        "expectancy",
        "index",
        "temperature",
        "temp",
    ];
    let lower = column.name.to_lowercase();
    lower.contains('%')
        || lower
            .split(|letter: char| !letter.is_alphanumeric())
            .any(|word| WORDS.contains(&word))
}

fn total_of(column: &ColumnProfile) -> Aggregate {
    if is_average_only(column) {
        Aggregate::Average
    } else {
        Aggregate::Sum
    }
}

fn measures(profile: &[ColumnProfile]) -> Vec<&ColumnProfile> {
    profile
        .iter()
        .filter(|column| {
            column.kind == ColumnKind::Number
                && !is_identifier(&column.name)
                && !looks_like_year(column)
        })
        .collect()
}

fn groups(profile: &[ColumnProfile]) -> Vec<&ColumnProfile> {
    profile
        .iter()
        .filter(|column| {
            matches!(column.kind, ColumnKind::Text | ColumnKind::Boolean)
                && (2..=MAX_GROUPS).contains(&column.unique_values)
                && !is_identifier(&column.name)
                && !looks_like_period(column)
        })
        .collect()
}

// When nearly every row has the same value, the column says little as a
// breakdown or a filter. A failed count keeps the column.
fn is_lopsided(source: &DraftSource, column: &ColumnProfile) -> bool {
    let present = source.table.opened.row_count as f64 * (1.0 - column.missing_percent / 100.0);
    column_values(&source.table.opened.source, &column.name, column.kind)
        .ok()
        .and_then(|counts| counts.first().map(|top| top.count as f64))
        .is_some_and(|top| present > 0.0 && top / present >= MAX_COMMON_SHARE)
}

fn useful_groups<'a>(source: &'a DraftSource) -> Vec<&'a ColumnProfile> {
    groups(&source.profile)
        .into_iter()
        .filter(|column| !is_lopsided(source, column))
        .collect()
}

struct Breakdown<'a> {
    column: &'a ColumnProfile,
    link: Option<&'a TableLink>,
}

// The main file's own groups come first, then groups looked up in linked files.
fn breakdowns<'a>(
    main: &'a DraftSource,
    sources: &'a [DraftSource],
    links: &'a [TableLink],
) -> Vec<Breakdown<'a>> {
    let mut found: Vec<Breakdown> = useful_groups(main)
        .into_iter()
        .map(|column| Breakdown { column, link: None })
        .collect();
    for link in links
        .iter()
        .filter(|link| link.from_table == main.table.name)
    {
        let Some(linked) = sources
            .iter()
            .find(|source| source.table.name == link.to_table)
        else {
            continue;
        };
        for column in useful_groups(linked) {
            let is_taken = main.profile.iter().any(|own| own.name == column.name)
                || found.iter().any(|known| known.column.name == column.name);
            if !is_taken {
                found.push(Breakdown {
                    column,
                    link: Some(link),
                });
            }
        }
    }
    found.truncate(MAX_DRAFT_GROUPS);
    found
}

fn looks_like_period(column: &ColumnProfile) -> bool {
    column.kind == ColumnKind::Text
        && column.min.as_deref().is_some_and(|value| {
            let bytes = value.as_bytes();
            bytes.len() >= 7
                && bytes[..4].iter().all(u8::is_ascii_digit)
                && bytes[4] == b'-'
                && bytes[5..7].iter().all(u8::is_ascii_digit)
        })
}

fn grain_for(column: &ColumnProfile) -> Option<Grain> {
    if column.kind != ColumnKind::Date {
        return None;
    }
    let year = |value: &Option<String>| value.as_deref()?.get(..4)?.parse::<i32>().ok();
    let span = year(&column.max)? - year(&column.min)?;
    let is_short = column
        .max
        .as_deref()
        .map(|value| &value[..7.min(value.len())])
        == column
            .min
            .as_deref()
            .map(|value| &value[..7.min(value.len())]);
    Some(match span {
        _ if is_short => Grain::Day,
        0..=2 => Grain::Month,
        3..=6 => Grain::Quarter,
        _ => Grain::Year,
    })
}

fn timeline(profile: &[ColumnProfile]) -> Option<&ColumnProfile> {
    profile
        .iter()
        .find(|column| column.kind == ColumnKind::Date)
        .or_else(|| profile.iter().find(|column| looks_like_period(column)))
        .or_else(|| profile.iter().find(|column| looks_like_year(column)))
}

// The main table is the biggest one with something to add up.
fn main_source<'a, 'b>(sources: &'a [DraftSource<'b>]) -> Option<&'a DraftSource<'b>> {
    sources
        .iter()
        .filter(|source| !measures(&source.profile).is_empty())
        .max_by_key(|source| source.table.opened.row_count)
        .or_else(|| {
            sources
                .iter()
                .max_by_key(|source| source.table.opened.row_count)
        })
}

struct Drafter<'a> {
    file: &'a str,
    table: &'a str,
    next: u32,
    prefix: String,
}

impl Drafter<'_> {
    fn figure(&mut self, title: &str, view: &str, spec: &QuerySpec) -> Block {
        let built = build_query(spec, self.table);
        self.block(title, view, built, Some(spec))
    }

    // Choices can't name a column from another file, so this block keeps no spec.
    fn linked_figure(
        &mut self,
        title: &str,
        view: &str,
        spec: &QuerySpec,
        link: &TableLink,
    ) -> Block {
        let built = build_linked_query(spec, link);
        self.block(title, view, built, None)
    }

    fn block(
        &mut self,
        title: &str,
        view: &str,
        built: BuiltQuery,
        spec: Option<&QuerySpec>,
    ) -> Block {
        self.next += 1;
        Block {
            id: format!("{}-{}", self.prefix, self.next),
            kind: BlockKind::Figure,
            title: title.to_owned(),
            sql: Some(built.sql),
            trend_sql: built.trend_sql,
            spec: spec.and_then(|spec| serde_json::to_value(spec).ok()),
            view: Some(view.to_owned()),
            x_column: built.x_column,
            y_column: Some(built.y_column),
            series_column: built.series_column,
            ..Block::default()
        }
    }

    fn spec(&self, aggregate: Aggregate, measure: Option<&str>) -> QuerySpec {
        QuerySpec {
            table: self.file.to_owned(),
            aggregate,
            measure: measure.map(str::to_owned),
            by: None,
            grain: None,
            series: None,
            trend_by: None,
            trend_grain: None,
        }
    }
}

fn readable(name: &str) -> String {
    let spaced = name.replace(['_', '-'], " ");
    let mut letters = spaced.chars();
    letters.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(letters).collect()
    })
}

fn numbers(page: &mut Page, drafter: &mut Drafter, profile: &[ColumnProfile]) {
    let measure = measures(profile).first().copied();
    let time = timeline(profile);
    let with_trend = |mut spec: QuerySpec| {
        if let Some(time) = time {
            spec.trend_by = Some(time.name.clone());
            spec.trend_grain = grain_for(time);
        }
        spec
    };
    if let Some(measure) = measure.filter(|measure| !is_average_only(measure)) {
        let spec = with_trend(drafter.spec(Aggregate::Sum, Some(&measure.name)));
        let block = drafter.figure(&format!("Total {}", measure.name), "number", &spec);
        place_block(page, block);
    }
    let spec = with_trend(drafter.spec(Aggregate::Count, None));
    let block = drafter.figure("Rows", "number", &spec);
    place_block(page, block);
    if let Some(measure) = measure {
        let spec = drafter.spec(Aggregate::Average, Some(&measure.name));
        let block = drafter.figure(&format!("Average {}", measure.name), "number", &spec);
        place_block(page, block);
    }
}

fn value_spec(drafter: &Drafter, profile: &[ColumnProfile]) -> QuerySpec {
    match measures(profile).first() {
        Some(measure) => drafter.spec(total_of(measure), Some(&measure.name)),
        None => drafter.spec(Aggregate::Count, None),
    }
}

fn over_time(page: &mut Page, drafter: &mut Drafter, profile: &[ColumnProfile], view: &str) {
    let Some(time) = timeline(profile) else {
        return;
    };
    let spec = QuerySpec {
        by: Some(time.name.clone()),
        grain: grain_for(time),
        ..value_spec(drafter, profile)
    };
    let name = measures(profile)
        .first()
        .map_or("Rows".to_owned(), |measure| readable(&measure.name));
    let block = Block {
        sort: Some("label".to_owned()),
        ..drafter.figure(&format!("{name} over time"), view, &spec)
    };
    place_block(page, block);
}

fn by_group(
    page: &mut Page,
    drafter: &mut Drafter,
    profile: &[ColumnProfile],
    breakdown: &Breakdown,
    view: &str,
) {
    let group = &breakdown.column.name;
    let spec = QuerySpec {
        by: Some(group.clone()),
        ..value_spec(drafter, profile)
    };
    let name = measures(profile)
        .first()
        .map_or("Rows".to_owned(), |measure| readable(&measure.name));
    let title = format!("{name} by {group}");
    let block = match breakdown.link {
        None => drafter.figure(&title, view, &spec),
        Some(link) => drafter.linked_figure(&title, view, &spec, link),
    };
    place_block(page, block);
}

fn add_filters(page: &mut Page, sources: &[DraftSource], main: &DraftSource) {
    if let Some(time) = main
        .profile
        .iter()
        .find(|column| column.kind == ColumnKind::Date)
    {
        page.filters.push(PageFilter {
            id: "filter-date".to_owned(),
            table: main.table.opened.name.clone(),
            column: time.name.clone(),
            kind: FilterKind::Dates,
            ..PageFilter::default()
        });
    }
    let linked = sources
        .iter()
        .filter(|source| source.table.name != main.table.name)
        .flat_map(|source| {
            useful_groups(source)
                .into_iter()
                .map(move |column| (source, column))
        });
    let own = useful_groups(main).into_iter().map(|column| (main, column));
    for (source, column) in own.chain(linked).take(2) {
        page.filters.push(PageFilter {
            id: format!("filter-{}", column.name),
            table: source.table.opened.name.clone(),
            column: column.name.clone(),
            ..PageFilter::default()
        });
    }
}

// Starting points need no AI: they're worked out from what's in the data.
pub fn draft_page(
    page: &mut Page,
    kind: DraftKind,
    sources: &[DraftSource],
    links: &[TableLink],
    prefix: &str,
) -> bool {
    let Some(main) = main_source(sources) else {
        return false;
    };
    let profile = &main.profile;
    let mut drafter = Drafter {
        file: &main.table.opened.name,
        table: &main.table.name,
        next: 0,
        prefix: prefix.to_owned(),
    };
    page.rows.clear();
    page.filters.clear();
    add_filters(page, sources, main);

    let breakdowns = breakdowns(main, sources, links);
    match kind {
        DraftKind::Overview => {
            numbers(page, &mut drafter, profile);
            over_time(page, &mut drafter, profile, "line");
            if let Some(group) = breakdowns.first() {
                by_group(page, &mut drafter, profile, group, "bar");
                by_group(page, &mut drafter, profile, group, "table");
            }
        }
        DraftKind::Trends => {
            numbers(page, &mut drafter, profile);
            over_time(page, &mut drafter, profile, "area");
            let count = QuerySpec {
                by: timeline(profile).map(|time| time.name.clone()),
                grain: timeline(profile).and_then(grain_for),
                ..drafter.spec(Aggregate::Count, None)
            };
            if count.by.is_some() {
                let block = Block {
                    sort: Some("label".to_owned()),
                    ..drafter.figure("Rows over time", "line", &count)
                };
                place_block(page, block);
            }
        }
        DraftKind::Compare => {
            numbers(page, &mut drafter, profile);
            for group in &breakdowns {
                by_group(page, &mut drafter, profile, group, "bar");
            }
            if let Some(group) = breakdowns.first() {
                by_group(page, &mut drafter, profile, group, "table");
            }
        }
        DraftKind::Report => {
            let intro = Block {
                id: format!("{prefix}-intro"),
                kind: BlockKind::Text,
                text: Some("Write what this report shows.".to_owned()),
                ..Block::default()
            };
            place_block(page, intro);
            numbers(page, &mut drafter, profile);
            over_time(page, &mut drafter, profile, "line");
            if let Some(group) = breakdowns.first() {
                by_group(page, &mut drafter, profile, group, "bar");
                by_group(page, &mut drafter, profile, group, "table");
            }
        }
    }
    !page.rows.is_empty()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    use davis_core::{QueryTable, find_links, open_table, profile_table, run_query, table_name};

    use super::*;

    static NEXT: AtomicU32 = AtomicU32::new(0);

    struct Folder(PathBuf);

    impl Folder {
        fn new() -> Self {
            let number = NEXT.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("davis-drafts-{}-{number}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn table(&self, file: &str, content: &str) -> ProjectTable {
            let path = self.0.join(file);
            fs::write(&path, content).unwrap();
            ProjectTable {
                name: table_name(file, &[]),
                opened: open_table(&path.to_string_lossy()).unwrap(),
            }
        }
    }

    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const ORDERS: &str = "order_id,customer_id,region,day,amount\n1,1,EMEA,2026-01-05,10\n2,1,EMEA,2026-02-05,5\n3,2,APAC,2026-02-07,20\n4,3,APAC,2026-03-01,1\n";

    fn empty_page() -> Page {
        Page {
            id: "p".to_owned(),
            title: "Page".to_owned(),
            updated_at: 1,
            rows: Vec::new(),
            filters: Vec::new(),
        }
    }

    fn draft(kind: DraftKind, tables: &[ProjectTable]) -> Page {
        let sources: Vec<DraftSource> = tables
            .iter()
            .map(|table| DraftSource {
                table,
                profile: profile_table(&table.opened.source).unwrap(),
            })
            .collect();
        let links = find_links(&query_tables(tables)).unwrap();
        let mut page = empty_page();
        draft_page(&mut page, kind, &sources, &links, "d");
        page
    }

    fn query_tables(tables: &[ProjectTable]) -> Vec<QueryTable> {
        tables
            .iter()
            .map(|table| QueryTable::new(table.name.clone(), table.opened.source.clone()))
            .collect()
    }

    fn blocks(page: &Page) -> impl Iterator<Item = &Block> {
        page.rows.iter().flat_map(|row| &row.blocks)
    }

    fn titles(page: &Page) -> Vec<Vec<&str>> {
        page.rows
            .iter()
            .map(|row| {
                row.blocks
                    .iter()
                    .map(|block| block.title.as_str())
                    .collect()
            })
            .collect()
    }

    #[test]
    fn an_overview_reads_numbers_then_charts_then_detail() {
        let folder = Folder::new();
        let page = draft(DraftKind::Overview, &[folder.table("orders.csv", ORDERS)]);

        assert_eq!(
            titles(&page),
            [
                vec!["Total amount", "Rows", "Average amount"],
                vec!["Amount over time", "Amount by region"],
                vec!["Amount by region"],
            ]
        );
        let views: Vec<&str> = page.rows[1]
            .blocks
            .iter()
            .filter_map(|block| block.view.as_deref())
            .collect();
        assert_eq!(views, ["line", "bar"]);
    }

    #[test]
    fn every_drafted_query_really_runs() {
        let folder = Folder::new();
        let table = folder.table("orders.csv", ORDERS);
        let tables = [QueryTable::new(
            table.name.clone(),
            table.opened.source.clone(),
        )];

        for kind in [
            DraftKind::Overview,
            DraftKind::Trends,
            DraftKind::Compare,
            DraftKind::Report,
        ] {
            let page = draft(kind, std::slice::from_ref(&table));
            for block in page.rows.iter().flat_map(|row| &row.blocks) {
                for sql in block.sql.iter().chain(&block.trend_sql) {
                    run_query(&tables, sql, Default::default()).unwrap();
                }
            }
        }
    }

    #[test]
    fn identifiers_are_never_added_up() {
        let folder = Folder::new();
        let page = draft(DraftKind::Overview, &[folder.table("orders.csv", ORDERS)]);

        let sql: Vec<&str> = page
            .rows
            .iter()
            .flat_map(|row| &row.blocks)
            .filter_map(|block| block.sql.as_deref())
            .collect();
        assert!(sql.iter().all(|sql| !sql.contains("sum(\"order_id\")")));
        assert!(sql.iter().all(|sql| !sql.contains("sum(\"customer_id\")")));
    }

    #[test]
    fn a_year_column_is_a_timeline_and_never_added_up() {
        let folder = Folder::new();
        let world = "country,Year,population\nAda,2000,5\nAda,2001,6\nBo,2000,7\n";
        let page = draft(DraftKind::Overview, &[folder.table("world.csv", world)]);

        assert_eq!(
            titles(&page)[0],
            ["Total population", "Rows", "Average population"]
        );
        let sql: Vec<&str> = blocks(&page)
            .filter_map(|block| block.sql.as_deref())
            .collect();
        assert!(sql.iter().all(|sql| !sql.contains("sum(\"Year\")")));
        let line = blocks(&page)
            .find(|block| block.view.as_deref() == Some("line"))
            .unwrap();
        assert_eq!(line.x_column.as_deref(), Some("Year"));
    }

    #[test]
    fn a_rate_is_averaged_instead_of_added_up() {
        let folder = Folder::new();
        let sales = "region,day,growth_rate\nEMEA,2026-01-05,0.1\nAPAC,2026-02-05,0.3\n";
        let page = draft(DraftKind::Overview, &[folder.table("sales.csv", sales)]);

        assert_eq!(titles(&page)[0], ["Rows", "Average growth_rate"]);
        let line = blocks(&page)
            .find(|block| block.view.as_deref() == Some("line"))
            .unwrap();
        assert!(
            line.sql
                .as_deref()
                .unwrap()
                .contains("avg(\"growth_rate\")")
        );
    }

    #[test]
    fn a_month_written_as_text_still_reads_in_time_order() {
        let folder = Folder::new();
        let orders = "month,amount\n2026-02,9\n2026-01,5\n2026-03,1\n";
        let page = draft(DraftKind::Trends, &[folder.table("orders.csv", orders)]);

        let line = page
            .rows
            .iter()
            .flat_map(|row| &row.blocks)
            .find(|block| block.view.as_deref() == Some("line"))
            .unwrap();
        assert_eq!(line.sort.as_deref(), Some("label"));
    }

    #[test]
    fn a_date_column_gets_a_range_filter_and_a_group_gets_a_list() {
        let folder = Folder::new();
        let page = draft(DraftKind::Overview, &[folder.table("orders.csv", ORDERS)]);

        assert_eq!(page.filters[0].kind, FilterKind::Dates);
        assert_eq!(page.filters[0].column, "day");
        assert_eq!(page.filters[1].kind, FilterKind::Values);
        assert_eq!(page.filters[1].column, "region");
    }

    #[test]
    fn a_group_in_a_linked_file_becomes_a_filter() {
        let folder = Folder::new();
        let orders = folder.table("orders.csv", "customer_id,amount\n1,5\n2,6\n3,7\n");
        let customers = folder.table(
            "customers.csv",
            "customer_id,region\n1,EMEA\n2,APAC\n3,EMEA\n",
        );

        let page = draft(DraftKind::Overview, &[orders, customers]);

        assert_eq!(page.filters[0].table, "customers.csv");
        assert_eq!(page.filters[0].column, "region");
    }

    #[test]
    fn a_breakdown_in_a_linked_file_is_looked_up() {
        let folder = Folder::new();
        let orders = folder.table("orders.csv", "customer_id,amount\n1,5\n2,6\n3,7\n");
        let customers = folder.table(
            "customers.csv",
            "customer_id,region\n1,EMEA\n2,APAC\n3,EMEA\n",
        );
        let files = [orders, customers];
        let tables = query_tables(&files);

        let page = draft(DraftKind::Overview, &files);

        let bar = blocks(&page)
            .find(|block| block.view.as_deref() == Some("bar"))
            .unwrap();
        assert_eq!(bar.title, "Amount by region");
        assert_eq!(bar.x_column.as_deref(), Some("region"));
        let result = run_query(&tables, bar.sql.as_deref().unwrap(), Default::default()).unwrap();
        let cell = |text: &str| Some(text.to_owned());
        assert_eq!(
            result.rows,
            [[cell("EMEA"), cell("12")], [cell("APAC"), cell("6")]]
        );
    }

    #[test]
    fn a_column_with_one_common_value_is_not_suggested() {
        let folder = Folder::new();
        let mut orders = "region,note,amount\n".to_owned();
        for row in 0..20 {
            let region = if row % 2 == 0 { "EMEA" } else { "APAC" };
            let note = if row == 0 { "check" } else { "ok" };
            orders.push_str(&format!("{region},{note},{row}\n"));
        }

        let page = draft(DraftKind::Compare, &[folder.table("orders.csv", &orders)]);

        let columns: Vec<&str> = page
            .filters
            .iter()
            .map(|filter| filter.column.as_str())
            .collect();
        assert_eq!(columns, ["region"]);
        assert!(blocks(&page).all(|block| block.x_column.as_deref() != Some("note")));
    }

    #[test]
    fn numbers_compare_with_the_previous_period() {
        let folder = Folder::new();
        let page = draft(DraftKind::Overview, &[folder.table("orders.csv", ORDERS)]);

        assert!(page.rows[0].blocks[0].trend_sql.is_some());
    }

    #[test]
    fn a_file_with_nothing_to_add_up_still_gets_a_page() {
        let folder = Folder::new();
        let page = draft(
            DraftKind::Overview,
            &[folder.table(
                "people.csv",
                "name,city\nAda,Oslo\nLinus,Oslo\nGrace,Rome\n",
            )],
        );

        assert_eq!(titles(&page)[0], ["Rows"]);
    }

    #[test]
    fn a_report_opens_with_something_to_write() {
        let folder = Folder::new();
        let page = draft(DraftKind::Report, &[folder.table("orders.csv", ORDERS)]);

        assert_eq!(page.rows[0].blocks[0].kind, BlockKind::Text);
    }
}
