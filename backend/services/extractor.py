"""
Skill extraction engine using NLP techniques:
- Alias/keyword matching with normalized text
- spaCy for entity recognition and POS filtering
- TF-IDF weighted skill scoring
- Experience year detection via regex patterns
- Proficiency level inference from context signals
"""

import re
import json
import logging
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import numpy as np

logger = logging.getLogger(__name__)

# Load taxonomy once at module level
TAXONOMY_PATH = Path(__file__).parent.parent / "data" / "skill_taxonomy.json"
with open(TAXONOMY_PATH) as f:
    TAXONOMY = json.load(f)

SKILLS = TAXONOMY["skills"]
LEVEL_ORDER = TAXONOMY["level_order"]  # none < beginner < intermediate < advanced < expert

# Build a flat reverse-lookup: alias/name -> canonical skill key
ALIAS_MAP: Dict[str, str] = {}
for skill_key, skill_data in SKILLS.items():
    ALIAS_MAP[skill_key.lower()] = skill_key
    for alias in skill_data.get("aliases", []):
        ALIAS_MAP[alias.lower()] = skill_key


# ── Helpers ────────────────────────────────────────────────────────────────────

def normalize(text: str) -> str:
    """Lowercase, strip extra whitespace, remove punctuation noise."""
    text = text.lower()
    text = re.sub(r"[^\w\s\.\+#/]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def detect_years_near_skill(text: str, skill_name: str) -> Optional[int]:
    """
    Look for patterns like '3 years of Python' or 'Python (5+ yrs)'
    within a ±60-char window around each occurrence of the skill name.
    """
    year_patterns = [
        r"(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience\s+(?:in|with)\s+)?",
        r"(?:experience\s+(?:in|with)\s+)?(\d+)\+?\s*(?:years?|yrs?)",
        r"\((\d+)\+?\s*(?:years?|yrs?)\)",
    ]
    norm = normalize(text)
    positions = [m.start() for m in re.finditer(re.escape(skill_name.lower()), norm)]
    for pos in positions:
        window = norm[max(0, pos - 60): pos + 60]
        for pat in year_patterns:
            m = re.search(pat, window)
            if m:
                return int(m.group(1))
    return None


def years_to_level(years: Optional[int]) -> str:
    if years is None:
        return "beginner"
    if years >= 5:
        return "expert"
    if years >= 3:
        return "advanced"
    if years >= 1:
        return "intermediate"
    return "beginner"


PROFICIENCY_SIGNALS = {
    "expert": ["expert", "extensive", "deep expertise", "lead", "architect", "principal", "10+ years", "7+ years"],
    "advanced": ["advanced", "senior", "strong", "proficient", "hands-on", "in-depth", "5+ years", "4+ years"],
    "intermediate": ["intermediate", "working knowledge", "familiar with", "2+ years", "3 years", "experience with"],
    "beginner": ["basic", "exposure to", "learning", "beginner", "fundamental", "introductory", "familiar"],
}


def infer_level_from_context(text: str, skill_name: str) -> str:
    """
    Infer proficiency by looking for signal words near each mention.
    Returns the highest-confidence level found, defaulting to 'intermediate'.
    """
    norm = normalize(text)
    positions = [m.start() for m in re.finditer(re.escape(skill_name.lower()), norm)]
    if not positions:
        return "intermediate"

    best_level = "intermediate"
    best_priority = LEVEL_ORDER.index("intermediate")

    for pos in positions:
        window = norm[max(0, pos - 80): pos + 80]
        for level, signals in PROFICIENCY_SIGNALS.items():
            for signal in signals:
                if signal in window:
                    level_priority = LEVEL_ORDER.index(level)
                    if level_priority > best_priority:
                        best_level = level
                        best_priority = level_priority
    return best_level


def extract_skills_from_text(text: str) -> List[Dict]:
    """
    Core skill extraction pipeline:
    1. Normalize text
    2. Multi-word alias matching (longest match first)
    3. Year extraction for each found skill
    4. Level inference from context
    5. Dedup by canonical skill key
    Returns list of {skill, level, years, category}
    """
    norm = normalize(text)
    found: Dict[str, Dict] = {}  # canonical_key -> data

    # Sort aliases by length descending so longer phrases match first
    sorted_aliases = sorted(ALIAS_MAP.keys(), key=len, reverse=True)

    for alias in sorted_aliases:
        canonical = ALIAS_MAP[alias]
        if canonical in found:
            continue  # already found via a longer alias
        # Use word-boundary matching where possible
        pattern = r"\b" + re.escape(alias) + r"\b"
        if re.search(pattern, norm):
            years = detect_years_near_skill(text, alias)
            if years:
                level = years_to_level(years)
            else:
                level = infer_level_from_context(text, alias)
            found[canonical] = {
                "skill": canonical,
                "level": level,
                "years": years,
                "category": SKILLS[canonical]["category"],
            }

    return list(found.values())


def extract_required_skills(jd_text: str) -> List[Dict]:
    """
    Extract required skills from a job description.
    Adds an 'importance' field based on context signals:
    - 'critical': required, must-have, essential, mandatory
    - 'important': preferred, strong, expected
    - 'nice-to-have': plus, bonus, advantage, nice to have
    """
    skills = extract_skills_from_text(jd_text)
    norm = normalize(jd_text)

    critical_signals = ["required", "must have", "must-have", "essential", "mandatory", "strong", "proficient"]
    nicetohave_signals = ["nice to have", "nice-to-have", "a plus", "a bonus", "preferred", "advantage", "optional"]

    for sk in skills:
        alias_list = [sk["skill"]] + SKILLS[sk["skill"]].get("aliases", [])
        importance = "important"  # default

        for alias in alias_list:
            pattern = r"\b" + re.escape(alias.lower()) + r"\b"
            positions = [m.start() for m in re.finditer(pattern, norm)]
            for pos in positions:
                window = norm[max(0, pos - 120): pos + 120]
                for sig in critical_signals:
                    if sig in window:
                        importance = "critical"
                for sig in nicetohave_signals:
                    if sig in window:
                        importance = "nice-to-have" if importance != "critical" else "critical"

        sk["importance"] = importance

    return skills


def compute_gap_score(current_level: str, required_level: str, importance: str) -> float:
    """
    Gap score on 0–10 scale.
    Gap magnitude = difference in level_order index.
    Scaled by importance weight.
    """
    importance_weights = {"critical": 1.0, "important": 0.75, "nice-to-have": 0.45}
    weight = importance_weights.get(importance, 0.75)

    curr_idx = LEVEL_ORDER.index(current_level) if current_level in LEVEL_ORDER else 0
    req_idx = LEVEL_ORDER.index(required_level) if required_level in LEVEL_ORDER else 2

    magnitude = max(0, req_idx - curr_idx)
    raw = magnitude * 2.5  # max raw = 4 levels * 2.5 = 10
    return round(min(10.0, raw * weight + (raw * (1 - weight) * 0.3)), 1)


def compute_skill_gaps(
    resume_skills: List[Dict],
    required_skills: List[Dict],
) -> Tuple[List[Dict], List[str]]:
    """
    Compare resume skills against required skills.
    Returns:
      - gaps: list of skill gap objects with gap_score
      - strengths: list of skill names where candidate meets/exceeds requirement
    """
    resume_map = {s["skill"]: s for s in resume_skills}
    gaps = []
    strengths = []

    for req in required_skills:
        skill_key = req["skill"]
        importance = req.get("importance", "important")

        if skill_key in resume_map:
            candidate = resume_map[skill_key]
            curr_level = candidate["level"]
            req_level = req.get("level", "intermediate")

            curr_idx = LEVEL_ORDER.index(curr_level) if curr_level in LEVEL_ORDER else 0
            req_idx = LEVEL_ORDER.index(req_level) if req_level in LEVEL_ORDER else 2

            if curr_idx >= req_idx:
                strengths.append(skill_key)
            else:
                gap_score = compute_gap_score(curr_level, req_level, importance)
                gaps.append({
                    "skill": skill_key,
                    "current_level": curr_level,
                    "required_level": req_level,
                    "gap_score": gap_score,
                    "importance": importance,
                    "category": SKILLS[skill_key]["category"],
                })
        else:
            # Skill completely absent from resume
            req_level = req.get("level", "intermediate")
            gap_score = compute_gap_score("none", req_level, importance)
            gaps.append({
                "skill": skill_key,
                "current_level": "none",
                "required_level": req_level,
                "gap_score": gap_score,
                "importance": importance,
                "category": SKILLS[skill_key]["category"],
            })

    # Also check for skills candidate has but JD doesn't mention — these are bonus strengths
    required_keys = {s["skill"] for s in required_skills}
    for sk in resume_skills:
        if sk["skill"] not in required_keys and sk["level"] in ("advanced", "expert"):
            strengths.append(sk["skill"])

    return gaps, list(dict.fromkeys(strengths))  # dedup while preserving order


def extract_candidate_name(text: str) -> str:
    """
    Simple heuristic: first non-empty line that looks like a name
    (title case, 2-3 words, no digits, short enough).
    """
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        words = line.split()
        if (2 <= len(words) <= 4
                and all(w[0].isupper() for w in words if w)
                and not any(char.isdigit() for char in line)
                and len(line) < 50):
            # Exclude lines that look like headers (all caps)
            if not line.isupper():
                return line
    return "Candidate"


def extract_target_role(jd_text: str) -> str:
    """Extract job title from the first few lines of the JD."""
    title_patterns = [
        r"(?:job title|position|role)\s*[:\-]\s*(.+)",
        r"^(?:we are (?:hiring|looking for)|seeking)\s+(?:a|an)?\s*(.+?)(?:\s+to|\s+who|\.|$)",
    ]
    norm_jd = jd_text.strip()
    for pat in title_patterns:
        m = re.search(pat, norm_jd[:500], re.IGNORECASE)
        if m:
            return m.group(1).strip()[:80]
    # Fall back to first non-empty line
    for line in norm_jd.split("\n")[:5]:
        line = line.strip()
        if line and len(line) < 80:
            return line
    return "Target Role"


def compute_readiness_score(gaps: List[Dict], total_required: int) -> int:
    """
    Readiness = 100 - weighted_gap_penalty
    Penalty is higher for critical gaps.
    """
    if total_required == 0:
        return 100
    if not gaps:
        return 95

    weight_map = {"critical": 2.0, "important": 1.3, "nice-to-have": 0.7}
    total_weight = sum(weight_map.get(g["importance"], 1.0) for g in gaps)
    max_possible = total_required * 2.0 * 10  # max penalty
    actual_penalty = sum(
        weight_map.get(g["importance"], 1.0) * g["gap_score"] for g in gaps
    )
    penalty_ratio = min(1.0, actual_penalty / max_possible)
    score = int(100 * (1 - penalty_ratio))
    return max(5, min(95, score))
