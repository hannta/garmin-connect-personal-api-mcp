"""Print the shape of a JSON response: key paths, types and one example value.

Usage: python3 -I discovery/shape.py discovery/raw/<file>.json [max_depth]
Arrays show their length and the shape of the first element only.
"""
import json
import sys


def example(value):
    text = json.dumps(value)
    return text if len(text) <= 40 else text[:37] + "..."


def walk(value, path, depth, max_depth):
    if isinstance(value, dict):
        if depth >= max_depth:
            print(f"{path or '.'}: object({len(value)} keys)")
            return
        for key, child in value.items():
            walk(child, f"{path}.{key}", depth + 1, max_depth)
    elif isinstance(value, list):
        print(f"{path or '.'}: array[{len(value)}]")
        if value and depth < max_depth:
            walk(value[0], f"{path}[0]", depth + 1, max_depth)
    else:
        print(f"{path}: {type(value).__name__} = {example(value)}")


data = json.load(open(sys.argv[1]))
walk(data, "", 0, int(sys.argv[2]) if len(sys.argv) > 2 else 4)
