"""
Updates venue_rules.json thresholds from collected corrections in training_data.jsonl.

Run manually after accumulating enough corrections (10+ per type recommended):
    python train.py

How it works:
  For each section type that has corrections, compute the 10th/90th percentile
  of each feature across all corrected examples. These become the new rule
  thresholds, replacing the defaults in venue_rules.json.
  Types with fewer than 3 examples are left unchanged.
"""

import json
from collections import defaultdict
from pathlib import Path

import numpy as np

TRAINING_PATH = Path(__file__).parent / "training_data.jsonl"
RULES_PATH    = Path(__file__).parent / "venue_rules.json"

FEATURE_KEYS = ["area_pct", "aspect_ratio", "cx_pct", "cy_pct", "solidity"]

# Conditions that make sense for each feature (min, max, or both)
FEATURE_CONDITION_STYLE = {
    "area_pct":    ("min", "max"),
    "aspect_ratio":("min",),
    "cx_pct":      ("min", "max"),
    "cy_pct":      ("min", "max"),
    "solidity":    ("min", "max"),
}


def load_corrections():
    if not TRAINING_PATH.exists():
        return []
    records = []
    with open(TRAINING_PATH) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return records


def compute_thresholds(records: list) -> dict[str, dict]:
    """
    Group records by corrected_type. For each type with >= 3 examples,
    compute 10th/90th percentile thresholds for each feature.
    Returns {type: {feature_condition_key: value}}.
    """
    by_type: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        ctype = r.get("corrected_type")
        feats = r.get("features", {})
        if ctype and feats:
            by_type[ctype].append(feats)

    thresholds = {}
    for stype, feat_list in by_type.items():
        if len(feat_list) < 3:
            print(f"  {stype}: only {len(feat_list)} examples — skipping (need ≥3)")
            continue

        conditions = {}
        for key in FEATURE_KEYS:
            vals = [f[key] for f in feat_list if key in f]
            if len(vals) < 3:
                continue
            arr = np.array(vals)
            styles = FEATURE_CONDITION_STYLE.get(key, ("min", "max"))
            if "min" in styles:
                conditions[f"{key}_min"] = round(float(np.percentile(arr, 10)), 4)
            if "max" in styles:
                conditions[f"{key}_max"] = round(float(np.percentile(arr, 90)), 4)

        thresholds[stype] = conditions
        print(f"  {stype}: {len(feat_list)} examples → {len(conditions)} conditions updated")

    return thresholds


def update_rules(thresholds: dict[str, dict]):
    with open(RULES_PATH) as f:
        data = json.load(f)

    rules = data["rules"]
    updated = 0
    for rule in rules:
        stype = rule["type"]
        if stype in thresholds:
            rule["conditions"] = thresholds[stype]
            updated += 1

    data["version"] = data.get("version", 1) + 1
    with open(RULES_PATH, "w") as f:
        json.dump(data, f, indent=2)

    print(f"\n  venue_rules.json updated (version {data['version']}) — {updated} rule(s) retuned")


def main():
    print("Loading corrections from training_data.jsonl …")
    records = load_corrections()
    if not records:
        print("  No corrections found. Use the MapEditor to correct section types after import.")
        return

    print(f"  {len(records)} correction(s) loaded\n")
    print("Computing thresholds …")
    thresholds = compute_thresholds(records)

    if not thresholds:
        print("  Not enough data to update any rules yet.")
        return

    print("\nUpdating venue_rules.json …")
    update_rules(thresholds)
    print("\nDone. Restart uvicorn to pick up the new rules.")


if __name__ == "__main__":
    main()
