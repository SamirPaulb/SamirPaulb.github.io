---
title: Highest Salaries Difference
summary: Highest Salaries Difference - Solution Explained
url: "/posts/highest-salaries-difference"
date: 2020-07-29T03:00:00
tags: ["leetcode", "problem-solving"]
series: [leetcode]
keywords: ["Highest Salaries Difference LeetCode Solution Explained in all languages", "2853", "leetcode question 2853", "Highest Salaries Difference", "LeetCode", "leetcode solution in Python3 C++ Java Go PHP Ruby Swift TypeScript Rust C# JavaScript C", "GeeksforGeeks", "InterviewBit", "Coding Ninjas", "HackerRank", "HackerEarth", "CodeChef", "TopCoder", "AlgoExpert", "freeCodeCamp", "Codeforces", "GitHub", "AtCoder", "Samir Paul"]
cover:
    image: https://spcdn.pages.dev/leetcode/images/highest-salaries-difference.webp
    alt: Highest Salaries Difference - Solution Explained
    hiddenInList: true
    hiddenInSingle: false
math: true
---


# [2853. Highest Salaries Difference](https://leetcode.com/problems/highest-salaries-difference)


## Description

<p>Table: <code><font face="monospace">Salaries</font></code></p>

<pre>
+-------------+---------+ 
| Column Name | Type    | 
+-------------+---------+ 
| emp_name    | varchar | 
| department  | varchar | 
| salary      | int     |
+-------------+---------+
(emp_name, department) is the primary key (combination of unique values) for this table.
Each row of this table contains emp_name, department and salary. There will be <strong>at least one</strong> entry for the engineering and marketing departments.
</pre>

<p>Write a solution&nbsp;to calculate the difference between the <strong>highest</strong> salaries in the <strong>marketing</strong> and <strong>engineering</strong> <code>department</code>. Output the absolute difference in salaries.</p>

<p>Return<em> the result table.</em></p>

<p>The&nbsp;result format is in the following example.</p>

<p>&nbsp;</p>
<p><strong class="example">Example 1:</strong></p>

<pre>
<strong>Input:</strong> 
Salaries table:
+----------+-------------+--------+
| emp_name | department  | salary |
+----------+-------------+--------+
| Kathy    | Engineering | 50000  |
| Roy      | Marketing   | 30000  |
| Charles  | Engineering | 45000  |
| Jack     | Engineering | 85000  | 
| Benjamin | Marketing   | 34000  |
| Anthony  | Marketing   | 42000  |
| Edward   | Engineering | 102000 |
| Terry    | Engineering | 44000  |
| Evelyn   | Marketing   | 53000  |
| Arthur   | Engineering | 32000  |
+----------+-------------+--------+
<strong>Output:</strong> 
+-------------------+
| salary_difference | 
+-------------------+
| 49000             | 
+-------------------+
<strong>Explanation:</strong> 
- The Engineering and Marketing departments have the highest salaries of 102,000 and 53,000, respectively. Resulting in an absolute difference of 49,000.
</pre>

## Solutions

### Solution 1: GROUP BY Clause

We can first calculate the highest salary for each department, and then calculate the difference between the two highest salaries.

<!-- tabs:start -->

{{< terminal title="SQL Code" >}}
```sql
# Write your MySQL query statement below
SELECT MAX(s) - MIN(s) AS salary_difference
FROM
    (
        SELECT MAX(salary) AS s
        FROM Salaries
        GROUP BY department
    ) AS t;
```
{{< /terminal >}}

<!-- tabs:end -->

<!-- end -->
