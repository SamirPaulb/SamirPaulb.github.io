---
title: Degree of an Array
summary: Degree of an Array - Solution Explained
url: "/posts/degree-of-an-array"
date: 2020-10-26T23:00:00
tags: ["leetcode", "problem-solving"]
series: [leetcode]
keywords: ["Degree of an Array LeetCode Solution Explained in all languages", "697", "leetcode question 697", "Degree of an Array", "LeetCode", "leetcode solution in Python3 C++ Java Go PHP Ruby Swift TypeScript Rust C# JavaScript C", "GeeksforGeeks", "InterviewBit", "Coding Ninjas", "HackerRank", "HackerEarth", "CodeChef", "TopCoder", "AlgoExpert", "freeCodeCamp", "Codeforces", "GitHub", "AtCoder", "Samir Paul"]
cover:
    image: https://spcdn.pages.dev/leetcode/images/degree-of-an-array.webp
    alt: Degree of an Array - Solution Explained
    hiddenInList: true
    hiddenInSingle: false
math: true
---


# [697. Degree of an Array](https://leetcode.com/problems/degree-of-an-array)


## Description

<p>Given a non-empty array of non-negative integers <code>nums</code>, the <b>degree</b> of this array is defined as the maximum frequency of any one of its elements.</p>

<p>Your task is to find the smallest possible length of a (contiguous) subarray of <code>nums</code>, that has the same degree as <code>nums</code>.</p>

<p>&nbsp;</p>
<p><strong class="example">Example 1:</strong></p>

<pre>
<strong>Input:</strong> nums = [1,2,2,3,1]
<strong>Output:</strong> 2
<strong>Explanation:</strong> 
The input array has a degree of 2 because both elements 1 and 2 appear twice.
Of the subarrays that have the same degree:
[1, 2, 2, 3, 1], [1, 2, 2, 3], [2, 2, 3, 1], [1, 2, 2], [2, 2, 3], [2, 2]
The shortest length is 2. So return 2.
</pre>

<p><strong class="example">Example 2:</strong></p>

<pre>
<strong>Input:</strong> nums = [1,2,2,3,1,4,2]
<strong>Output:</strong> 6
<strong>Explanation:</strong> 
The degree is 3 because the element 2 is repeated 3 times.
So [2,2,3,1,4,2] is the shortest subarray, therefore returning 6.
</pre>

<p>&nbsp;</p>
<p><strong>Constraints:</strong></p>

<ul>
	<li><code>nums.length</code> will be between 1 and 50,000.</li>
	<li><code>nums[i]</code> will be an integer between 0 and 49,999.</li>
</ul>

## Solutions

### Solution 1

<!-- tabs:start -->

{{< terminal title="Python Code" >}}
```python
class Solution:
    def findShortestSubArray(self, nums: List[int]) -> int:
        cnt = Counter(nums)
        degree = cnt.most_common()[0][1]
        left, right = {}, {}
        for i, v in enumerate(nums):
            if v not in left:
                left[v] = i
            right[v] = i
        ans = inf
        for v in nums:
            if cnt[v] == degree:
                t = right[v] - left[v] + 1
                if ans > t:
                    ans = t
        return ans
```
{{< /terminal >}}

{{< terminal title="Java Code" >}}
```java
class Solution {
    public int findShortestSubArray(int[] nums) {
        Map<Integer, Integer> cnt = new HashMap<>();
        Map<Integer, Integer> left = new HashMap<>();
        Map<Integer, Integer> right = new HashMap<>();
        int degree = 0;
        for (int i = 0; i < nums.length; ++i) {
            int v = nums[i];
            cnt.put(v, cnt.getOrDefault(v, 0) + 1);
            degree = Math.max(degree, cnt.get(v));
            if (!left.containsKey(v)) {
                left.put(v, i);
            }
            right.put(v, i);
        }
        int ans = 1000000;
        for (int v : nums) {
            if (cnt.get(v) == degree) {
                int t = right.get(v) - left.get(v) + 1;
                if (ans > t) {
                    ans = t;
                }
            }
        }
        return ans;
    }
}
```
{{< /terminal >}}

{{< terminal title="C++ Code" >}}
```cpp
class Solution {
public:
    int findShortestSubArray(vector<int>& nums) {
        unordered_map<int, int> cnt;
        unordered_map<int, int> left;
        unordered_map<int, int> right;
        int degree = 0;
        for (int i = 0; i < nums.size(); ++i) {
            int v = nums[i];
            degree = max(degree, ++cnt[v]);
            if (!left.count(v)) {
                left[v] = i;
            }
            right[v] = i;
        }
        int ans = 1e6;
        for (int v : nums) {
            if (cnt[v] == degree) {
                int t = right[v] - left[v] + 1;
                if (ans > t) {
                    ans = t;
                }
            }
        }
        return ans;
    }
};
```
{{< /terminal >}}

{{< terminal title="Go Code" >}}
```go
func findShortestSubArray(nums []int) int {
	cnt := map[int]int{}
	left := map[int]int{}
	right := map[int]int{}
	var degree int
	for i, v := range nums {
		cnt[v]++
		if degree < cnt[v] {
			degree = cnt[v]
		}
		if _, ok := left[v]; !ok {
			left[v] = i
		}
		right[v] = i
	}
	ans := 100000
	for v, c := range cnt {
		if c == degree {
			t := right[v] - left[v] + 1
			if ans > t {
				ans = t
			}
		}
	}
	return ans
}
```
{{< /terminal >}}

<!-- tabs:end -->

### Solution 2

<!-- tabs:start -->

{{< terminal title="Go Code" >}}
```go
func findShortestSubArray(nums []int) (ans int) {
	ans = 50000
	numsMap := make(map[int]int, len(nums))
	for _, num := range nums {
		numsMap[num]++
	}
	var maxDegree int
	for _, num := range numsMap {
		maxDegree = max(num, maxDegree)
	}
	degreeNums := getMaxDegreeElem(maxDegree, numsMap)
	for _, num := range degreeNums {
		f := findSubArray(num, nums)
		ans = min(ans, f)
	}
	return
}

func findSubArray(target int, nums []int) int {
	start := getStartIdx(target, nums)
	end := getEndIdx(target, nums)
	return (end - start) + 1
}

func getStartIdx(target int, nums []int) (start int) {
	for idx, num := range nums {
		if num == target {
			start = idx
			break
		}
	}
	return start
}

func getEndIdx(target int, nums []int) (end int) {
	for i := len(nums) - 1; i > 0; i-- {
		if nums[i] == target {
			end = i
			break
		}
	}
	return
}

func getMaxDegreeElem(maxDegree int, numsMap map[int]int) []int {
	var ans []int
	for key, value := range numsMap {
		if value == maxDegree {
			ans = append(ans, key)
		}
	}
	return ans
}
```
{{< /terminal >}}

<!-- tabs:end -->

<!-- end -->