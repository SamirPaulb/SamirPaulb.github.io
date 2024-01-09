---
title: Maximum Sum Increasing Subsequence   Gfg
summary: Maximum Sum Increasing Subsequence   Gfg LeetCode Solution Explained
date: 2020-06-20
tags: [leetcode]
series: [leetcode]
keywords: ["LeetCode", "leetcode solution in Python3 C++ Java", "Maximum sum increasing subsequence - GFG LeetCode Solution Explained"]
cover:
    image: https://res.cloudinary.com/samirpaul/image/upload/w_1100,c_fit,co_rgb:FFFFFF,l_text:Arial_75_bold:Maximum Sum Increasing Subsequence   Gfg - Solution Explained/problem-solving.webp
    alt: Maximum Sum Increasing Subsequence   Gfg
    hiddenInList: true
    hiddenInSingle: false
---


# Maximum sum increasing subsequence
## Medium
<div class="problems_problem_content__Xm_eO"><p><span style="font-size:18px">Given an array of n positive integers. Find the sum of the maximum sum subsequence of the given array such that the integers in the subsequence are sorted in strictly increasing order i.e. a strictly increasing subsequence.&nbsp;</span></p>

<p><span style="font-size:18px"><strong>Example 1:</strong></span></p>

<pre><span style="font-size:18px"><strong>Input</strong>: N = 5, arr[] = {1, 101, 2, 3, 100} 
<strong>Output:</strong> 106
<strong>Explanation</strong>:The maximum sum of a
increasing sequence is obtained from
{1, 2, 3, 100}</span></pre>

<p><span style="font-size:18px"><strong>Example 2:</strong></span></p>

<pre><span style="font-size:18px"><strong>Input</strong>: N = 3, arr[] = {1, 2, 3}
<strong>Output:</strong> 6
<strong>Explanation</strong>:The maximum sum of a
increasing sequence is obtained from
{1, 2, 3}</span></pre>

<p><br>
<span style="font-size:18px"><strong>Your Task:&nbsp;&nbsp;</strong><br>
You don't need to read input or print anything. Complete the function <strong><code>maxSumIS</code>()&nbsp;</strong>which takes <strong>N </strong>and array <strong>arr </strong>as input parameters and returns the maximum value.</span></p>

<p><br>
<span style="font-size:18px"><strong>Expected Time Complexity:</strong> O(<strong>N<sup>2</sup></strong>)<br>
<strong>Expected Auxiliary Space:</strong> O(<strong>N</strong>)</span></p>

<p><br>
<span style="font-size:18px"><strong>Constraints:</strong><br>
1 ≤ N ≤ 10<sup>3</sup></span><br>
<span style="font-size:18px">1 ≤ arr[i] ≤ 10<sup>5</sup></span></p>
</div>

---




```python
#User function Template for python3
class Solution:
	def maxSumIS(self, Arr, n):
		# code here
		dp = Arr.copy()
		for r in range(1, len(Arr)):
		    for l in range(r):
		        if Arr[l] < Arr[r]:
		            dp[r] = max(dp[r], Arr[r] + dp[l])
		return max(dp)
		
		
		


#{ 
 # Driver Code Starts
#Initial Template for Python 3

if __name__ == '__main__':
	T=int(input())
	for i in range(T):
		n = int(input())
		Arr = [int(x) for x in input().split()]
		ob = Solution()
		ans = ob.maxSumIS(Arr,n)
		print(ans)

# } Driver Code Ends
```