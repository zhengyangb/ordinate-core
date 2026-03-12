from __future__ import annotations

from pathlib import Path


def load_spec_cases(path: Path) -> list[dict[str, str]]:
    content = path.read_text(encoding="utf-8")
    chunks = [c.strip() for c in content.split("===") if c.strip()]
    cases: list[dict[str, str]] = []

    for chunk in chunks:
        lines = chunk.splitlines()
        name = lines[0].strip()
        body = "\n".join(lines[1:])

        case: dict[str, str] = {"name": name}
        doc_start = body.find("[doc]\n")
        doc_end = body.find("\n[/doc]")
        if doc_start == -1 or doc_end == -1:
            raise ValueError(f"case '{name}' missing [doc] block")

        doc = body[doc_start + len("[doc]\n") : doc_end]
        case["doc"] = doc.strip()

        tail = body[doc_end + len("\n[/doc]") :].strip()
        for line in tail.splitlines():
            item = line.strip()
            if not item or item.startswith("#"):
                continue
            key, value = item.split(":", 1)
            case[key.strip()] = value.strip()

        cases.append(case)

    return cases


def parse_scalar(value: str):
    if value == "true":
        return True
    if value == "false":
        return False
    if value == "null":
        return None
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        return value
