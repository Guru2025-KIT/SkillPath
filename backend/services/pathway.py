"""
Adaptive Pathing Engine

Implements a priority-weighted, dependency-aware learning pathway generator.

Algorithm:
1. Build a directed skill dependency graph (using NetworkX)
2. For each gap skill, look up matching course(s) from the catalog
3. Topological sort ensures prerequisites come before advanced modules
4. Gaps are binned into phases by: priority tier, category affinity, cognitive load
5. Each phase gets a name, duration estimate, and description

This is entirely original logic — no LLM used at any step.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Set
import networkx as nx

logger = logging.getLogger(__name__)

TAXONOMY_PATH = Path(__file__).parent.parent / "data" / "skill_taxonomy.json"
with open(TAXONOMY_PATH) as f:
    TAXONOMY = json.load(f)

SKILLS = TAXONOMY["skills"]
COURSE_CATALOG = TAXONOMY["course_catalog"]
LEVEL_ORDER = TAXONOMY["level_order"]


# ── Dependency Graph ───────────────────────────────────────────────────────────

def build_dependency_graph(gap_skills: List[str]) -> nx.DiGraph:
    """
    Build a directed graph where edge A→B means "A is a prerequisite of B".
    Only includes nodes relevant to the gap skill set (and their prereqs).
    """
    G = nx.DiGraph()
    to_process = set(gap_skills)
    visited: Set[str] = set()

    while to_process:
        skill = to_process.pop()
        if skill in visited:
            continue
        visited.add(skill)
        G.add_node(skill)
        prereqs = SKILLS.get(skill, {}).get("prerequisites", [])
        for prereq in prereqs:
            G.add_edge(prereq, skill)  # prereq must come before skill
            if prereq not in visited:
                to_process.add(prereq)

    return G


def topological_order(G: nx.DiGraph, gap_skills: List[str]) -> List[str]:
    """
    Return nodes in topological order. If a cycle exists (shouldn't with well-formed data),
    fall back to degree-sorted order.
    """
    try:
        order = list(nx.topological_sort(G))
        # Filter to only the gap skills (prerequisites may be in graph but already known)
        return [s for s in order if s in gap_skills]
    except nx.NetworkXUnfeasible:
        logger.warning("Cycle detected in skill graph, falling back to simple sort")
        return sorted(gap_skills)


# ── Course Matching ────────────────────────────────────────────────────────────

def find_course(skill: str, current_level: str, required_level: str) -> Optional[Dict]:
    """
    Find the best matching course from the catalog for a given skill gap.
    Prioritizes:
    1. Exact from_level match
    2. Closest from_level
    3. Any course for that skill
    """
    curr_idx = LEVEL_ORDER.index(current_level) if current_level in LEVEL_ORDER else 0
    req_idx = LEVEL_ORDER.index(required_level) if required_level in LEVEL_ORDER else 2
    # Normalize current: 'none' → treat as 'beginner' for course matching
    effective_from = "beginner" if current_level == "none" else current_level

    candidates = [
        (cid, cdata) for cid, cdata in COURSE_CATALOG.items()
        if cdata["skill"] == skill
    ]

    if not candidates:
        return None

    # Score each candidate: prefer from_level matching effective_from
    def score(c):
        cdata = c[1]
        from_match = 1 if cdata.get("from_level", "") == effective_from else 0
        target_gap = abs(LEVEL_ORDER.index(cdata.get("target_level", "intermediate")) - req_idx)
        return (from_match, -target_gap)

    candidates.sort(key=score, reverse=True)
    best_id, best_data = candidates[0]
    return {"id": best_id, **best_data}


# ── Phase Binning ──────────────────────────────────────────────────────────────

PHASE_TEMPLATES = [
    {
        "phase": 1,
        "name": "Core Foundations",
        "description": "Address the most critical skill gaps blocking role entry. These are the non-negotiables — without them, day-to-day work is blocked.",
        "criteria": lambda g: g["importance"] == "critical" and g["gap_score"] >= 6,
    },
    {
        "phase": 2,
        "name": "Skill Consolidation",
        "description": "Build on the foundations with important skills needed for full productivity. These are expected within the first 60 days.",
        "criteria": lambda g: g["importance"] in ("critical", "important") and g["gap_score"] >= 3,
    },
    {
        "phase": 3,
        "name": "Role Proficiency",
        "description": "Deepen domain expertise and cross-functional skills to reach full role competency. Targets independent contribution.",
        "criteria": lambda g: g["importance"] == "important" and g["gap_score"] < 6,
    },
    {
        "phase": 4,
        "name": "Advanced Mastery",
        "description": "Nice-to-have and advanced skills that differentiate high performers. Targeted for completion in the first 6 months.",
        "criteria": lambda g: True,  # catch-all
    },
]


def assign_phase(gap: Dict) -> int:
    for template in PHASE_TEMPLATES:
        if template["criteria"](gap):
            return template["phase"]
    return 4


# ── Priority Label ─────────────────────────────────────────────────────────────

def module_priority(importance: str, gap_score: float) -> str:
    if importance == "critical" or gap_score >= 7:
        return "high"
    if importance == "important" or gap_score >= 4:
        return "medium"
    return "low"


# ── Main Pathway Builder ───────────────────────────────────────────────────────

def build_learning_pathway(
    gaps: List[Dict],
    resume_skills: List[Dict],
) -> Dict:
    """
    Full adaptive pathing pipeline:
    1. Build dependency graph from gap skill set
    2. Topological sort to respect prerequisites
    3. Assign each gap to a phase
    4. Find best course for each gap
    5. Assemble phases with metadata
    6. Generate reasoning trace

    Returns dict with learning_pathway list and reasoning_trace.
    """
    if not gaps:
        return {
            "learning_pathway": [],
            "estimated_total_weeks": 0,
            "reasoning_trace": {
                "gap_analysis_method": "No significant skill gaps were detected. The candidate meets all requirements.",
                "pathway_logic": "No pathway needed — candidate is ready for the role.",
                "priority_rationale": "All required skills are already at or above the required proficiency level.",
            },
        }

    gap_skill_keys = [g["skill"] for g in gaps]
    resume_map = {s["skill"]: s for s in resume_skills}

    # Step 1: Dependency graph
    G = build_dependency_graph(gap_skill_keys)
    ordered_gaps = topological_order(G, gap_skill_keys)

    # Rebuild gap map for quick lookup
    gap_map = {g["skill"]: g for g in gaps}

    # Step 2: Assign phases
    phases_raw: Dict[int, List[Dict]] = {1: [], 2: [], 3: [], 4: []}

    for skill_key in ordered_gaps:
        gap = gap_map.get(skill_key)
        if not gap:
            continue
        phase_num = assign_phase(gap)
        course = find_course(skill_key, gap["current_level"], gap["required_level"])

        if not course:
            # Build a minimal module even without a catalog match
            module = {
                "id": f"mod_{skill_key.replace(' ', '_')}",
                "title": f"Learn {skill_key.title()}",
                "skill_addressed": skill_key,
                "type": "course",
                "estimated_hours": 10,
                "priority": module_priority(gap["importance"], gap["gap_score"]),
                "resources": [
                    {
                        "name": f"Search '{skill_key} tutorial'",
                        "url": f"https://www.google.com/search?q={skill_key.replace(' ', '+')}+tutorial",
                        "free": True,
                    }
                ],
                "learning_outcomes": [
                    f"Gain working knowledge of {skill_key}",
                    f"Apply {skill_key} in a professional context",
                ],
                "prerequisites": [
                    p for p in SKILLS.get(skill_key, {}).get("prerequisites", [])
                    if p in gap_skill_keys
                ],
                "gap_score": gap["gap_score"],
                "importance": gap["importance"],
            }
        else:
            prereqs_in_pathway = [
                p for p in SKILLS.get(skill_key, {}).get("prerequisites", [])
                if p in gap_skill_keys
            ]
            module = {
                "id": course["id"],
                "title": course["title"],
                "skill_addressed": skill_key,
                "type": course.get("type", "course"),
                "estimated_hours": course.get("hours", 10),
                "priority": module_priority(gap["importance"], gap["gap_score"]),
                "resources": [
                    {
                        "name": course.get("provider", "Online Resource"),
                        "url": course.get("url", "#"),
                        "free": course.get("free", True),
                    }
                ],
                "learning_outcomes": course.get("outcomes", []),
                "prerequisites": prereqs_in_pathway,
                "gap_score": gap["gap_score"],
                "importance": gap["importance"],
            }

        phases_raw[phase_num].append(module)

    # Step 3: Collapse empty phases and estimate duration
    pathway = []
    total_hours = 0

    for template in PHASE_TEMPLATES:
        phase_num = template["phase"]
        modules = phases_raw[phase_num]
        if not modules:
            continue
        hours = sum(m["estimated_hours"] for m in modules)
        # Rough estimate: 10 hrs/week capacity for new hires
        weeks = max(1, round(hours / 10))
        total_hours += hours

        pathway.append({
            "phase": len(pathway) + 1,
            "phase_name": template["name"],
            "duration_weeks": weeks,
            "description": template["description"],
            "modules": sorted(modules, key=lambda m: (-m["gap_score"])),  # highest gap first
        })

    total_weeks = sum(p["duration_weeks"] for p in pathway)

    # Step 4: Build reasoning trace
    critical_count = sum(1 for g in gaps if g["importance"] == "critical")
    topo_skills = ", ".join(ordered_gaps[:5]) + ("..." if len(ordered_gaps) > 5 else "")
    prereq_pairs = [
        f"{u}→{v}" for u, v in G.edges()
        if u in gap_skill_keys and v in gap_skill_keys
    ]

    reasoning_trace = {
        "gap_analysis_method": (
            f"Skills were extracted from the resume and job description using alias-based NLP matching "
            f"across a taxonomy of {len(SKILLS)} skills. Gap scores were computed using the formula: "
            f"gap_score = level_delta × 2.5 × importance_weight, where level_delta = required_level_index − current_level_index "
            f"and importance weights are critical=1.0, important=0.75, nice-to-have=0.45. "
            f"A total of {len(gaps)} gaps were found, {critical_count} of which are critical."
        ),
        "pathway_logic": (
            f"Modules were ordered using a topological sort on the skill dependency graph "
            f"({G.number_of_nodes()} nodes, {G.number_of_edges()} edges). "
            f"Topological order ensures prerequisites are learned before dependents. "
            f"Processing order: {topo_skills}. "
            + (f"Identified prerequisite chains: {', '.join(prereq_pairs[:4])}." if prereq_pairs else "No prerequisite chains detected in the gap set.")
        ),
        "priority_rationale": (
            f"Modules are binned into {len(pathway)} phases: Phase 1 holds critical gaps with gap_score ≥ 6, "
            f"Phase 2 holds important skills with gap_score ≥ 3, Phase 3 holds remaining important skills, "
            f"Phase 4 holds nice-to-have skills. Within each phase, modules are sorted by gap_score descending. "
            f"Total estimated learning load: {total_hours} hours across {total_weeks} weeks, "
            f"assuming 10 hours/week of training time."
        ),
    }

    return {
        "learning_pathway": pathway,
        "estimated_total_weeks": total_weeks,
        "reasoning_trace": reasoning_trace,
    }
