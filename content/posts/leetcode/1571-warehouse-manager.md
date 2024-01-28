---
title: 1571 Warehouse Manager
summary: 1571 Warehouse Manager LeetCode Solution Explained
date: 2022-11-25
tags: [leetcode]
series: [leetcode]
keywords: ["1571 Warehouse Manager LeetCode Solution Explained in all languages", "1571 Warehouse Manager", "LeetCode", "leetcode solution in Python3 C++ Java Go PHP Ruby Swift TypeScript Rust C# JavaScript C", "GeeksforGeeks", "InterviewBit", "Coding Ninjas", "HackerRank", "HackerEarth", "CodeChef", "TopCoder", "AlgoExpert", "freeCodeCamp", "Codeforces", "GitHub", "AtCoder", "Samir Paul"]
cover:
    image: https://res.cloudinary.com/samirpaul/image/upload/w_1100,c_fit,co_rgb:FFFFFF,l_text:Arial_75_bold:1571 Warehouse Manager - Solution Explained/problem-solving.webp
    alt: 1571 Warehouse Manager
    hiddenInList: true
    hiddenInSingle: false
math: true
---


# [1571. Warehouse Manager](https://leetcode.com/problems/warehouse-manager)


## Description

<p>Table: <code>Warehouse</code></p>

<pre>
+--------------+---------+
| Column Name  | Type    |
+--------------+---------+
| name         | varchar |
| product_id   | int     |
| units        | int     |
+--------------+---------+
(name, product_id) is the primary key (combination of columns with unique values) for this table.
Each row of this table contains the information of the products in each warehouse.
</pre>

<p>&nbsp;</p>

<p>Table: <code>Products</code></p>

<pre>
+---------------+---------+
| Column Name   | Type    |
+---------------+---------+
| product_id    | int     |
| product_name  | varchar |
| Width         | int     |
| Length        | int     |
| Height        | int     |
+---------------+---------+
product_id is the primary key (column with unique values) for this table.
Each row of this table contains information about the product dimensions (Width, Lenght, and Height) in feets of each product.
</pre>

<p>&nbsp;</p>

<p>Write a solution to report the number of cubic feet of <strong>volume </strong>the inventory occupies in each warehouse.</p>

<p>Return the result table in <strong>any order</strong>.</p>

<p>The query result format is in the following example.</p>

<p>&nbsp;</p>
<p><strong class="example">Example 1:</strong></p>

<pre>
<strong>Input:</strong> 
Warehouse table:
+------------+--------------+-------------+
| name       | product_id   | units       |
+------------+--------------+-------------+
| LCHouse1   | 1            | 1           |
| LCHouse1   | 2            | 10          |
| LCHouse1   | 3            | 5           |
| LCHouse2   | 1            | 2           |
| LCHouse2   | 2            | 2           |
| LCHouse3   | 4            | 1           |
+------------+--------------+-------------+
Products table:
+------------+--------------+------------+----------+-----------+
| product_id | product_name | Width      | Length   | Height    |
+------------+--------------+------------+----------+-----------+
| 1          | LC-TV        | 5          | 50       | 40        |
| 2          | LC-KeyChain  | 5          | 5        | 5         |
| 3          | LC-Phone     | 2          | 10       | 10        |
| 4          | LC-T-Shirt   | 4          | 10       | 20        |
+------------+--------------+------------+----------+-----------+
<strong>Output:</strong> 
+----------------+------------+
| warehouse_name | volume     | 
+----------------+------------+
| LCHouse1       | 12250      | 
| LCHouse2       | 20250      |
| LCHouse3       | 800        |
+----------------+------------+
<strong>Explanation:</strong> 
Volume of product_id = 1 (LC-TV), 5x50x40 = 10000
Volume of product_id = 2 (LC-KeyChain), 5x5x5 = 125 
Volume of product_id = 3 (LC-Phone), 2x10x10 = 200
Volume of product_id = 4 (LC-T-Shirt), 4x10x20 = 800
LCHouse1: 1 unit of LC-TV + 10 units of LC-KeyChain + 5 units of LC-Phone.
          Total volume: 1*10000 + 10*125  + 5*200 = 12250 cubic feet
LCHouse2: 2 units of LC-TV + 2 units of LC-KeyChain.
          Total volume: 2*10000 + 2*125 = 20250 cubic feet
LCHouse3: 1 unit of LC-T-Shirt.
          Total volume: 1*800 = 800 cubic feet.
</pre>

## Solutions

### Solution 1: Inner Join + Group By + Sum Function

We can use an inner join to join the `Warehouse` table and the `Products` table on the condition of `product_id`, and then group by warehouse name to calculate the inventory of each warehouse using the `SUM` function.

<!-- tabs:start -->

```sql
# Write your MySQL query statement below
SELECT
    name AS warehouse_name,
    SUM(width * length * height * units) AS volume
FROM
    Warehouse
    JOIN Products USING (product_id)
GROUP BY 1;
```

<!-- tabs:end -->

<!-- end -->