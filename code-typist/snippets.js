// Authentic, idiomatic code snippets for the typing tutor.
// Each snippet uses 4-space indent (tabs replaced) so users
// don't fight browser tab focus behavior.

const SNIPPETS = {
  go: [
    {
      title: "HTTP hello server",
      code: `package main

import (
    "fmt"
    "net/http"
)

func handler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "Hello, %s!", r.URL.Path[1:])
}

func main() {
    http.HandleFunc("/", handler)
    http.ListenAndServe(":8080", nil)
}`,
    },
    {
      title: "Worker pool with channels",
      code: `func worker(id int, jobs <-chan int, results chan<- int) {
    for j := range jobs {
        results <- j * 2
    }
}

func main() {
    jobs := make(chan int, 100)
    results := make(chan int, 100)

    for w := 1; w <= 3; w++ {
        go worker(w, jobs, results)
    }
}`,
    },
    {
      title: "JSON marshal a struct",
      code: `type User struct {
    Name  string \`json:"name"\`
    Email string \`json:"email"\`
    Admin bool   \`json:"admin,omitempty"\`
}

data, err := json.Marshal(user)
if err != nil {
    log.Fatal(err)
}`,
    },
    {
      title: "Error wrap pattern",
      code: `file, err := os.Open("data.txt")
if err != nil {
    return fmt.Errorf("open: %w", err)
}
defer file.Close()

scanner := bufio.NewScanner(file)
for scanner.Scan() {
    fmt.Println(scanner.Text())
}`,
    },
    {
      title: "Context with timeout",
      code: `ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
if err != nil {
    return err
}
resp, err := http.DefaultClient.Do(req)`,
    },
    {
      title: "Generic filter function",
      code: `func filter[T any](items []T, pred func(T) bool) []T {
    out := make([]T, 0, len(items))
    for _, v := range items {
        if pred(v) {
            out = append(out, v)
        }
    }
    return out
}`,
    },
    {
      title: "Interface and method receiver",
      code: `type Shape interface {
    Area() float64
}

type Circle struct {
    Radius float64
}

func (c Circle) Area() float64 {
    return math.Pi * c.Radius * c.Radius
}`,
    },
    {
      title: "Mutex-protected counter",
      code: `type Counter struct {
    mu    sync.Mutex
    count int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.count++
}`,
    },
    {
      title: "WaitGroup fan-out",
      code: `var wg sync.WaitGroup
for _, url := range urls {
    wg.Add(1)
    go func(u string) {
        defer wg.Done()
        fetch(u)
    }(url)
}
wg.Wait()`,
    },
    {
      title: "Slice of structs sort",
      code: `sort.Slice(people, func(i, j int) bool {
    return people[i].Age < people[j].Age
})

for _, p := range people {
    fmt.Printf("%s: %d\\n", p.Name, p.Age)
}`,
    },
  ],

  python: [
    {
      title: "List comprehension with filter",
      code: `squares = [x * x for x in range(20) if x % 2 == 0]
print(squares)

# Equivalent imperative form
result = []
for x in range(20):
    if x % 2 == 0:
        result.append(x * x)`,
    },
    {
      title: "Class with type hints",
      code: `class Point:
    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y

    def distance(self, other: "Point") -> float:
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5`,
    },
    {
      title: "Generator function",
      code: `def fibonacci(n: int):
    a, b = 0, 1
    for _ in range(n):
        yield a
        a, b = b, a + b

for value in fibonacci(10):
    print(value)`,
    },
    {
      title: "Context manager",
      code: `import json

with open("data.json") as f:
    data = json.load(f)
    for item in data["items"]:
        print(item["name"])`,
    },
    {
      title: "Decorator pattern",
      code: `import time

def timer(func):
    def wrapper(*args, **kwargs):
        start = time.time()
        result = func(*args, **kwargs)
        elapsed = time.time() - start
        print(f"{func.__name__}: {elapsed:.3f}s")
        return result
    return wrapper`,
    },
    {
      title: "Async HTTP fetch",
      code: `import asyncio
import aiohttp

async def fetch(url: str) -> dict:
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            resp.raise_for_status()
            return await resp.json()`,
    },
    {
      title: "Dataclass",
      code: `from dataclasses import dataclass

@dataclass
class User:
    name: str
    email: str
    active: bool = True

    def __post_init__(self) -> None:
        self.email = self.email.lower()`,
    },
    {
      title: "Argparse CLI",
      code: `import argparse

parser = argparse.ArgumentParser(description="Process logs")
parser.add_argument("--input", required=True)
parser.add_argument("--count", type=int, default=10)
parser.add_argument("--verbose", action="store_true")
args = parser.parse_args()`,
    },
    {
      title: "Pytest fixture",
      code: `import pytest

@pytest.fixture
def sample_data():
    return {"users": ["alice", "bob"], "count": 2}

def test_user_count(sample_data):
    assert sample_data["count"] == len(sample_data["users"])`,
    },
    {
      title: "boto3 list S3 buckets",
      code: `import boto3

session = boto3.Session(profile_name="default")
s3 = session.client("s3")

response = s3.list_buckets()
for bucket in response["Buckets"]:
    print(bucket["Name"], bucket["CreationDate"])`,
    },
  ],

  bash: [
    {
      title: "Loop over files",
      code: `for f in *.log; do
    echo "Processing $f"
    gzip "$f"
done`,
    },
    {
      title: "If/elif/else",
      code: `if [[ -f "$1" ]]; then
    echo "File exists"
elif [[ -d "$1" ]]; then
    echo "Directory exists"
else
    echo "Not found"
fi`,
    },
    {
      title: "Function with locals",
      code: `backup() {
    local src="$1"
    local dest="\${2:-/tmp/backup}"
    rsync -av --delete "$src" "$dest"
}

backup /home/eddie /mnt/backup`,
    },
    {
      title: "Trap on EXIT",
      code: `tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

echo "data" > "$tmpfile"
process "$tmpfile"`,
    },
    {
      title: "Find with exec",
      code: `find /var/log -name "*.log" \\
    -mtime +7 \\
    -exec gzip {} \\;`,
    },
    {
      title: "Curl + jq pipeline",
      code: `curl -sf "https://api.github.com/users/$1" \\
    | jq -r '.public_repos'`,
    },
    {
      title: "Read file line by line",
      code: `while IFS=: read -r user _ uid _ _; do
    if (( uid >= 1000 )); then
        echo "$user"
    fi
done < /etc/passwd`,
    },
    {
      title: "Getopts CLI parser",
      code: `while getopts "u:p:f" opt; do
    case "$opt" in
        u) user="$OPTARG" ;;
        p) port="$OPTARG" ;;
        f) force=1 ;;
        *) exit 1 ;;
    esac
done`,
    },
    {
      title: "AWS CLI with profile",
      code: `aws s3 ls \\
    --profile eddie-lab \\
    --region us-east-1 \\
    | awk '{print $3}'`,
    },
    {
      title: "Set strict mode",
      code: `#!/usr/bin/env bash
set -euo pipefail
IFS=$'\\n\\t'

readonly LOG_DIR="/var/log/myapp"
readonly RETENTION_DAYS=30

main() {
    find "$LOG_DIR" -mtime +"$RETENTION_DAYS" -delete
}

main "$@"`,
    },
  ],
};
