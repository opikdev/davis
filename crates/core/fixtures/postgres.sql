CREATE TABLE customers (customer_id int PRIMARY KEY, name text, region text);
INSERT INTO customers VALUES (1, 'Ada', 'EMEA'), (2, 'Linus', 'EMEA'), (3, 'Grace', 'APAC');
CREATE TABLE orders (order_id int PRIMARY KEY, customer_id int REFERENCES customers, ordered_at date, amount numeric(10, 2));
INSERT INTO orders VALUES (1, 1, '2026-01-05', 10), (2, 2, '2026-02-07', 20), (3, 3, '2026-03-01', 5.5);
CREATE VIEW big_orders AS SELECT * FROM orders WHERE amount > 8;
