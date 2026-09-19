"""Unnormalized code-point edit distance for authored OCR evaluation labels."""


def text_metrics(*, actual, expected):
    if (not isinstance(actual, str) or not isinstance(expected, str)
            or len(actual) > 4096 or len(expected) > 4096):
        raise ValueError("bounded Unicode strings required")
    previous = list(range(len(actual) + 1))
    for reference_index, reference_char in enumerate(expected, start=1):
        row = [reference_index]
        for actual_index, actual_char in enumerate(actual, start=1):
            row.append(min(previous[actual_index] + 1, row[-1] + 1,
                           previous[actual_index - 1] + (reference_char != actual_char)))
        previous = row
    edits = previous[-1]
    return {"exact": actual == expected, "edit_distance": edits, "reference_codepoints": len(expected),
            "actual_codepoints": len(actual), "cer": edits / len(expected) if expected else None,
            "normalization": "none; spaces/case/punctuation preserved"}


def aggregate_metrics(*, cases):
    if not cases:
        raise ValueError("nonempty evaluated corpus required")
    edits = sum(case["edit_distance"] for case in cases)
    reference = sum(case["reference_codepoints"] for case in cases)
    return {"cases": len(cases), "exact": sum(case["exact"] for case in cases),
            "edit_distance": edits, "reference_codepoints": reference,
            "cer": edits / reference if reference else None}
