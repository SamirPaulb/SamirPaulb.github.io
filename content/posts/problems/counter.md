---
title: Counter
summary: Counter - Solution Explained
url: "/posts/counter"
date: 2020-08-07T20:00:00
tags: ["leetcode", "problem-solving"]
series: [leetcode]
keywords: ["Counter LeetCode Solution Explained in all languages", "2620", "leetcode question 2620", "Counter", "LeetCode", "leetcode solution in Python3 C++ Java Go PHP Ruby Swift TypeScript Rust C# JavaScript C", "GeeksforGeeks", "InterviewBit", "Coding Ninjas", "HackerRank", "HackerEarth", "CodeChef", "TopCoder", "AlgoExpert", "freeCodeCamp", "Codeforces", "GitHub", "AtCoder", "Samir Paul"]
cover:
    image: https://spcdn.pages.dev/leetcode/images/counter.webp
    alt: Counter - Solution Explained
    hiddenInList: true
    hiddenInSingle: false
math: true
---


# [2620. Counter](https://leetcode.com/problems/counter)


## Description

<p>Given an integer&nbsp;<code>n</code>,&nbsp;return a <code>counter</code> function. This <code>counter</code> function initially returns&nbsp;<code>n</code>&nbsp;and then returns 1 more than the previous value every subsequent time it is called (<code>n</code>, <code>n + 1</code>, <code>n + 2</code>, etc).</p>

<p>&nbsp;</p>
<p><strong class="example">Example 1:</strong></p>

<pre>
<strong>Input:</strong> 
n = 10 
[&quot;call&quot;,&quot;call&quot;,&quot;call&quot;]
<strong>Output:</strong> [10,11,12]
<strong>Explanation: 
</strong>counter() = 10 // The first time counter() is called, it returns n.
counter() = 11 // Returns 1 more than the previous time.
counter() = 12 // Returns 1 more than the previous time.
</pre>

<p><strong class="example">Example 2:</strong></p>

<pre>
<strong>Input:</strong> 
n = -2
[&quot;call&quot;,&quot;call&quot;,&quot;call&quot;,&quot;call&quot;,&quot;call&quot;]
<strong>Output:</strong> [-2,-1,0,1,2]
<strong>Explanation:</strong> counter() initially returns -2. Then increases after each sebsequent call.
</pre>

<p>&nbsp;</p>
<p><strong>Constraints:</strong></p>

<ul>
	<li><code>-1000<sup>&nbsp;</sup>&lt;= n &lt;= 1000</code></li>
	<li><code>0 &lt;= calls.length &lt;= 1000</code></li>
	<li><code>calls[i] === &quot;call&quot;</code></li>
</ul>

## Solutions

### Solution 1

<!-- tabs:start -->

{{< terminal title="TypeScript Code" >}}
```ts
function createCounter(n: number): () => number {
    let i = n;
    return function () {
        return i++;
    };
}

/**
 * const counter = createCounter(10)
 * counter() // 10
 * counter() // 11
 * counter() // 12
 */
```
{{< /terminal >}}

<!-- tabs:end -->

<!-- end -->
