"""
extras.py — Four judge-impressing features:

1. ATS Score Simulation   — keyword density + section detection + formatting signals
2. Resume Suggestions     — actionable fixes based on gaps and missing keywords
3. Personalized Roadmap   — week-by-week calendar from existing pathway phases
4. Job Recommendations    — role-fit matching from resume skills vs role profiles
"""

import re
import json
from pathlib import Path
from typing import Dict, List

TAXONOMY_PATH = Path(__file__).parent.parent / "data" / "skill_taxonomy.json"
with open(TAXONOMY_PATH) as f:
    TAXONOMY = json.load(f)

SKILLS    = TAXONOMY["skills"]
LEVEL_ORDER = TAXONOMY["level_order"]

# ── 1. ATS SCORE SIMULATION ───────────────────────────────────────────────────

RESUME_SECTIONS = {
    "contact":    ["email", "phone", "linkedin", "github", "address", "mobile", "contact"],
    "summary":    ["summary", "objective", "profile", "about me", "overview"],
    "experience": ["experience", "work history", "employment", "professional experience", "career"],
    "education":  ["education", "degree", "university", "college", "bachelor", "master", "b.tech", "b.e", "m.tech"],
    "skills":     ["skills", "technical skills", "core competencies", "technologies", "tools"],
    "projects":   ["projects", "project", "portfolio"],
    "certifications": ["certification", "certificate", "certified", "credential"],
}

QUANTIFICATION_PATTERNS = [
    r"\d+%",              # 30%
    r"\$\s*\d+",          # $50k
    r"\d+\s*(?:users?|customers?|clients?|teams?|members?)",
    r"(?:reduced|increased|improved|grew|scaled|saved|delivered)\s+\w+\s+by\s+\d+",
    r"\d+\s*(?:x|times)\s+(?:faster|better|more)",
    r"\d+\+?\s*(?:years?|months?)",
]

ACTION_VERBS = [
    "built", "developed", "designed", "implemented", "created", "led", "managed",
    "architected", "optimised", "optimized", "delivered", "launched", "scaled",
    "reduced", "increased", "improved", "automated", "deployed", "integrated",
    "migrated", "refactored", "maintained", "collaborated", "mentored", "shipped",
]


def compute_ats_score(
    resume_text: str,
    resume_skills: List[Dict],
    required_skills: List[Dict],
    skill_gaps: List[Dict],
) -> Dict:
    """
    Simulate an ATS (Applicant Tracking System) pass on the resume.
    Returns a score breakdown across 5 dimensions.
    """
    norm = resume_text.lower()

    # ── Dimension 1: Keyword Match (35 pts) ──────────────────────────────────
    required_keys = {s["skill"] for s in required_skills}
    resume_keys   = {s["skill"] for s in resume_skills}
    matched_keys  = required_keys & resume_keys
    kw_rate       = len(matched_keys) / max(len(required_keys), 1)
    kw_score      = round(kw_rate * 35)

    # ── Dimension 2: Section Presence (25 pts) ───────────────────────────────
    sections_found = {}
    for section, signals in RESUME_SECTIONS.items():
        sections_found[section] = any(sig in norm for sig in signals)

    critical_sections = ["experience", "education", "skills"]
    bonus_sections    = ["summary", "projects", "certifications", "contact"]
    critical_hit = sum(sections_found.get(s, False) for s in critical_sections)
    bonus_hit    = sum(sections_found.get(s, False) for s in bonus_sections)
    section_score = round((critical_hit / 3) * 18 + (bonus_hit / 4) * 7)

    # ── Dimension 3: Quantified Achievements (20 pts) ────────────────────────
    quant_hits = sum(1 for p in QUANTIFICATION_PATTERNS if re.search(p, norm, re.IGNORECASE))
    quant_score = min(20, quant_hits * 4)

    # ── Dimension 4: Action Verb Usage (10 pts) ──────────────────────────────
    verb_hits = sum(1 for v in ACTION_VERBS if re.search(r"\b" + v + r"\b", norm))
    verb_score = min(10, verb_hits * 2)

    # ── Dimension 5: Length & Density (10 pts) ───────────────────────────────
    word_count = len(resume_text.split())
    if 300 <= word_count <= 800:
        length_score = 10
    elif word_count < 300:
        length_score = max(0, round((word_count / 300) * 10))
    else:
        # Penalise very long resumes (ATS truncates)
        length_score = max(4, 10 - round((word_count - 800) / 200))

    total = kw_score + section_score + quant_score + verb_score + length_score

    # ── Breakdown detail ──────────────────────────────────────────────────────
    missing_critical = [
        s["skill"] for s in required_skills
        if s["skill"] not in resume_keys and s.get("importance") == "critical"
    ]
    missing_important = [
        s["skill"] for s in required_skills
        if s["skill"] not in resume_keys and s.get("importance") == "important"
    ]

    return {
        "total_score": total,
        "grade": _ats_grade(total),
        "breakdown": {
            "keyword_match":    {"score": kw_score,      "max": 35, "label": "Keyword Match"},
            "section_presence": {"score": section_score,  "max": 25, "label": "Section Structure"},
            "quantification":   {"score": quant_score,    "max": 20, "label": "Quantified Achievements"},
            "action_verbs":     {"score": verb_score,     "max": 10, "label": "Action Verb Usage"},
            "length_density":   {"score": length_score,   "max": 10, "label": "Length & Density"},
        },
        "sections_detected": sections_found,
        "keyword_hit_rate":    round(kw_rate * 100),
        "matched_keywords":    sorted(matched_keys),
        "missing_critical":    missing_critical[:8],
        "missing_important":   missing_important[:8],
        "word_count":          word_count,
        "quantified_hits":     quant_hits,
        "action_verb_hits":    verb_hits,
        "tips": _ats_tips(sections_found, kw_rate, quant_hits, verb_hits, word_count, missing_critical),
    }


def _ats_grade(score: int) -> str:
    if score >= 85: return "A"
    if score >= 70: return "B"
    if score >= 55: return "C"
    if score >= 40: return "D"
    return "F"


def _ats_tips(sections, kw_rate, quant, verbs, words, missing_crit):
    tips = []
    if kw_rate < 0.6:
        tips.append("Add more JD keywords — ATS filters by exact phrase match before a human reads your resume.")
    if missing_crit:
        tips.append(f"Add these critical missing skills to your Skills section: {', '.join(missing_crit[:4])}.")
    if not sections.get("summary"):
        tips.append("Add a 3-line professional summary at the top — ATS parsers and recruiters both read it first.")
    if quant < 2:
        tips.append("Quantify at least 3 achievements (e.g. 'reduced load time by 40%') — ATS scores are higher for measurable impact.")
    if verbs < 4:
        tips.append("Start each bullet with an action verb (Built, Designed, Led, Optimised) — passive bullets rank lower.")
    if words < 300:
        tips.append("Resume is too short — ATS expects 300–700 words. Add project details or a skills section.")
    if words > 900:
        tips.append("Resume may be too long — many ATS systems truncate after page 2. Trim to the most recent 5 years.")
    if not sections.get("certifications"):
        tips.append("Add a Certifications section — even online certificates signal initiative to ATS screeners.")
    return tips[:5]


# ── 2. RESUME IMPROVEMENT SUGGESTIONS ────────────────────────────────────────

def generate_resume_suggestions(
    resume_text: str,
    resume_skills: List[Dict],
    required_skills: List[Dict],
    skill_gaps: List[Dict],
    candidate_name: str,
    target_role: str,
) -> Dict:
    """
    Generate actionable, specific resume improvement suggestions
    without calling any external LLM — purely deterministic.
    """
    norm = resume_text.lower()
    resume_map = {s["skill"]: s for s in resume_skills}

    suggestions = []

    # ── Missing critical keywords ─────────────────────────────────────────────
    critical_missing = [
        g["skill"] for g in skill_gaps
        if g.get("importance") == "critical" and g["current_level"] == "none"
    ]
    if critical_missing:
        suggestions.append({
            "category": "Missing Keywords",
            "priority": "high",
            "icon": "🔴",
            "title": f"Add {len(critical_missing)} critical missing skill{'s' if len(critical_missing)>1 else ''}",
            "detail": f"These are required in the JD but absent from your resume: {', '.join(critical_missing[:5])}.",
            "action": f"Even beginner-level exposure counts — add a 'Learning' subsection if needed.",
        })

    # ── Underlevelled skills ──────────────────────────────────────────────────
    underlevelled = [
        g for g in skill_gaps
        if g["current_level"] not in ("none",) and g["gap_score"] >= 3
    ]
    if underlevelled:
        worst = sorted(underlevelled, key=lambda x: -x["gap_score"])[:3]
        for g in worst:
            suggestions.append({
                "category": "Undersold Skills",
                "priority": "high",
                "icon": "🟠",
                "title": f"Strengthen how you present '{g['skill']}'",
                "detail": f"Your resume signals {g['current_level']} level, but the JD requires {g['required_level']}.",
                "action": f"Add a project bullet that demonstrates {g['skill']} at {g['required_level']} depth — specific tools, scale, outcome.",
            })

    # ── Quantification ────────────────────────────────────────────────────────
    quant_hits = sum(1 for p in QUANTIFICATION_PATTERNS if re.search(p, norm, re.IGNORECASE))
    if quant_hits < 3:
        suggestions.append({
            "category": "Impact & Numbers",
            "priority": "medium",
            "icon": "📊",
            "title": "Add numbers to your achievements",
            "detail": f"Only {quant_hits} quantified result{'s' if quant_hits!=1 else ''} detected. Recruiters and ATS both reward measurable outcomes.",
            "action": "Rewrite 3 bullets using: Reduced X by Y%, Scaled to Z users, Delivered N features in M weeks.",
        })

    # ── Missing sections ──────────────────────────────────────────────────────
    if not any(sig in norm for sig in RESUME_SECTIONS["summary"]):
        suggestions.append({
            "category": "Structure",
            "priority": "medium",
            "icon": "📝",
            "title": "Add a professional summary",
            "detail": "No summary section detected. Recruiters spend 6 seconds on initial scan — a 3-line summary anchors that scan.",
            "action": f"Write: '{candidate_name} is a [your role] with X years of experience in [top 3 skills]. Seeking to bring [value] to {target_role} roles.'",
        })

    if not any(sig in norm for sig in RESUME_SECTIONS["projects"]):
        suggestions.append({
            "category": "Structure",
            "priority": "medium",
            "icon": "🛠",
            "title": "Add a Projects section",
            "detail": "No projects section detected. Projects demonstrate applied skills that work experience alone may not show.",
            "action": "Add 2–3 projects with: Tech stack used, Your specific role, Measurable outcome or link.",
        })

    # ── Action verbs ──────────────────────────────────────────────────────────
    verb_hits = sum(1 for v in ACTION_VERBS if re.search(r"\b" + v + r"\b", norm))
    if verb_hits < 5:
        suggestions.append({
            "category": "Language",
            "priority": "low",
            "icon": "✍️",
            "title": "Use stronger action verbs",
            "detail": f"Only {verb_hits} action verbs detected. Passive language reduces impact score.",
            "action": "Replace 'Was responsible for X' with 'Architected X'. Replace 'Helped with Y' with 'Built Y'.",
        })

    # ── Certifications ────────────────────────────────────────────────────────
    if not any(sig in norm for sig in RESUME_SECTIONS["certifications"]):
        crit_skills = [g["skill"] for g in skill_gaps if g.get("importance") == "critical"][:2]
        if crit_skills:
            suggestions.append({
                "category": "Credibility",
                "priority": "low",
                "icon": "🏆",
                "title": "Add relevant certifications",
                "detail": "No certifications section found. Certificates for gap skills signal commitment to interviewers.",
                "action": f"Consider free/fast certs: Google, AWS, or Coursera certificates for {', '.join(crit_skills)}.",
            })

    # ── Strengths to highlight ────────────────────────────────────────────────
    strong_skills = [
        s for s in resume_skills
        if s["level"] in ("advanced", "expert") and s["skill"] in {r["skill"] for r in required_skills}
    ]
    if strong_skills:
        top = strong_skills[:3]
        suggestions.append({
            "category": "Highlight Strengths",
            "priority": "low",
            "icon": "⭐",
            "title": f"Lead with your {len(top)} strongest matching skill{'s' if len(top)>1 else ''}",
            "detail": f"You're {', '.join(s['level'] for s in top)} in {', '.join(s['skill'] for s in top)} — all required by the JD.",
            "action": "Put these in your summary and list them first in your Skills section to maximise ATS and recruiter visibility.",
        })

    # Sort by priority
    order = {"high": 0, "medium": 1, "low": 2}
    suggestions.sort(key=lambda x: order.get(x["priority"], 3))

    return {
        "total_suggestions": len(suggestions),
        "high_priority": sum(1 for s in suggestions if s["priority"] == "high"),
        "suggestions": suggestions,
    }


# ── 3. PERSONALIZED ROADMAP (week-by-week calendar) ──────────────────────────

def build_weekly_roadmap(learning_pathway: List[Dict]) -> Dict:
    """
    Turn the phase-based pathway into a week-by-week calendar with
    daily targets, milestones, and a motivational arc.
    """
    if not learning_pathway:
        return {
            "total_weeks": 0,
            "weeks": [],
            "milestones": [],
            "daily_target_hours": 0,
        }

    weeks = []
    milestones = []
    week_num = 0

    for phase in learning_pathway:
        phase_modules = phase.get("modules", [])
        phase_weeks   = phase.get("duration_weeks", 1)
        phase_hours   = sum(m.get("estimated_hours", 0) for m in phase_modules)
        hours_per_week = round(phase_hours / max(phase_weeks, 1), 1)

        # Distribute modules across the phase weeks
        mods_per_week = max(1, len(phase_modules) // max(phase_weeks, 1))

        for w in range(phase_weeks):
            week_num += 1
            week_mods = phase_modules[w * mods_per_week: (w + 1) * mods_per_week]
            # Last week of phase gets any remaining modules
            if w == phase_weeks - 1:
                week_mods = phase_modules[w * mods_per_week:]

            skills_this_week = [m["skill_addressed"] for m in week_mods]
            hours_this_week  = sum(m.get("estimated_hours", 0) for m in week_mods) or hours_per_week
            daily_hours      = round(hours_this_week / 5, 1)  # 5 learning days

            weeks.append({
                "week": week_num,
                "phase": phase["phase"],
                "phase_name": phase["phase_name"],
                "focus": skills_this_week,
                "modules": [
                    {
                        "title": m["title"],
                        "skill": m["skill_addressed"],
                        "hours": m.get("estimated_hours", 0),
                        "priority": m.get("priority", "medium"),
                        "resource": m.get("resources", [{}])[0].get("name", ""),
                        "url": m.get("resources", [{}])[0].get("url", ""),
                        "free": m.get("resources", [{}])[0].get("free", True),
                    }
                    for m in week_mods
                ],
                "estimated_hours": round(hours_this_week, 1),
                "daily_hours": daily_hours,
                "tasks": _week_tasks(week_mods, w, phase_weeks),
            })

        # Add milestone at end of each phase
        milestones.append({
            "week": week_num,
            "phase": phase["phase"],
            "title": f"Phase {phase['phase']} Complete: {phase['phase_name']}",
            "skills_unlocked": [m["skill_addressed"] for m in phase_modules],
            "checkpoint": _milestone_checkpoint(phase),
        })

    total_hours = sum(w["estimated_hours"] for w in weeks)
    avg_daily   = round(total_hours / (len(weeks) * 5), 1) if weeks else 0

    return {
        "total_weeks": week_num,
        "total_hours": round(total_hours, 1),
        "daily_target_hours": avg_daily,
        "weeks": weeks,
        "milestones": milestones,
    }


def _week_tasks(modules: List[Dict], week_in_phase: int, total_phase_weeks: int) -> List[str]:
    tasks = []
    if week_in_phase == 0:
        tasks.append("Start with the official documentation or intro video for each skill.")
    for m in modules[:2]:
        tasks.append(f"Complete '{m['title']}' ({m.get('estimated_hours', 0)}h).")
    if modules:
        tasks.append(f"Build a small practice project using {modules[0]['skill_addressed']}.")
    if week_in_phase == total_phase_weeks - 1:
        tasks.append("Review the week's material and update your resume Skills section.")
    return tasks[:4]


def _milestone_checkpoint(phase: Dict) -> str:
    names = {
        "Core Foundations":    "You should now be able to pass a basic screening call on these skills.",
        "Skill Consolidation": "You're now productive in the role — ready for most day-to-day tasks.",
        "Role Proficiency":    "You can contribute independently. Consider a portfolio project to demonstrate mastery.",
        "Advanced Mastery":    "You've exceeded the minimum bar. These skills make you a standout candidate.",
    }
    return names.get(phase.get("phase_name", ""), "Phase complete — review and reflect.")


# ── 4. JOB RECOMMENDATIONS ────────────────────────────────────────────────────

# Role profiles: canonical skill keys required per role (subset of taxonomy)
JOB_PROFILES = {
    "Frontend Developer": {
        "required": ["react", "javascript", "css", "html", "typescript"],
        "bonus":    ["next.js", "redux", "tailwind", "graphql", "testing"],
        "description": "Build responsive UIs and client-side applications.",
        "salary_range": "₹6L – ₹18L",
        "category": "Engineering",
        "apply_links": [
            {"platform": "LinkedIn",  "url": "https://www.linkedin.com/jobs/search/?keywords=Frontend+Developer&location=India"},
            {"platform": "Naukri",    "url": "https://www.naukri.com/frontend-developer-jobs"},
            {"platform": "Indeed",    "url": "https://in.indeed.com/jobs?q=Frontend+Developer"},
        ],
    },
    "Backend Developer": {
        "required": ["python", "rest api", "sql", "postgresql"],
        "bonus":    ["docker", "redis", "fastapi", "microservices", "message queue"],
        "description": "Design and build server-side systems and APIs.",
        "salary_range": "₹7L – ₹22L",
        "category": "Engineering",
        "apply_links": [
            {"platform": "LinkedIn",  "url": "https://www.linkedin.com/jobs/search/?keywords=Backend+Developer&location=India"},
            {"platform": "Naukri",    "url": "https://www.naukri.com/backend-developer-jobs"},
            {"platform": "Indeed",    "url": "https://in.indeed.com/jobs?q=Backend+Developer"},
        ],
    },
    "Full Stack Developer": {
        "required": ["react", "javascript", "python", "sql"],
        "bonus":    ["node.js", "docker", "postgresql", "typescript", "rest api"],
        "description": "Build end-to-end web applications across the full stack.",
        "salary_range": "₹8L – ₹24L",
        "category": "Engineering",
        "apply_links": [
            {"platform": "LinkedIn",  "url": "https://www.linkedin.com/jobs/search/?keywords=Full+Stack+Developer&location=India"},
            {"platform": "Naukri",    "url": "https://www.naukri.com/full-stack-developer-jobs"},
            {"platform": "Indeed",    "url": "https://in.indeed.com/jobs?q=Full+Stack+Developer"},
        ],
    },
    "DevOps Engineer": {
        "required": ["docker", "kubernetes", "ci/cd", "linux"],
        "bonus":    ["terraform", "ansible", "aws", "prometheus", "grafana"],
        "description": "Automate infrastructure, deployments, and monitoring pipelines.",
        "salary_range": "₹10L – ₹28L",
        "category": "Engineering",
        "apply_links": [
            {"platform": "LinkedIn",  "url": "https://www.linkedin.com/jobs/search/?keywords=DevOps+Engineer&location=India"},
            {"platform": "Naukri",    "url": "https://www.naukri.com/devops-engineer-jobs"},
            {"platform": "Indeed",    "url": "https://in.indeed.com/jobs?q=DevOps+Engineer"},
        ],
    },
    "Data Scientist": {
        "required": ["python", "machine learning", "statistics", "pandas"],
        "bonus":    ["tensorflow", "pytorch", "scikit-learn", "data visualization", "sql"],
        "description": "Build predictive models and extract insights from data.",
        "salary_range": "₹8L – ₹25L",
        "category": "Data",
        "apply_links": [
            {"platform": "LinkedIn",  "url": "https://www.linkedin.com/jobs/search/?keywords=Data+Scientist&location=India"},
            {"platform": "Naukri",    "url": "https://www.naukri.com/data-scientist-jobs"},
            {"platform": "Indeed",    "url": "https://in.indeed.com/jobs?q=Data+Scientist"},
        ],
    },
    "ML Engineer": {
        "required": ["python", "machine learning", "pytorch", "mlops"],
        "bonus":    ["tensorflow", "docker", "kubernetes", "airflow", "spark"],
        "description": "Deploy and scale machine learning models into production.",
        "salary_range": "₹12L – ₹35L",
        "category": "Data",
        "apply_links": [
            {"platform": "LinkedIn",  "url": "https://www.linkedin.com/jobs/search/?keywords=Machine+Learning+Engineer&location=India"},
            {"platform": "Naukri",    "url": "https://www.naukri.com/machine-learning-engineer-jobs"},
            {"platform": "Indeed",    "url": "https://in.indeed.com/jobs?q=Machine+Learning+Engineer"},
        ],
    },
    "Data Engineer": {
        "required": ["python", "sql", "spark", "data engineering"],
        "bonus":    ["airflow", "dbt", "kafka", "snowflake", "docker"],
        "description": "Build reliable data pipelines and warehousing systems.",
        "salary_range": "₹9L – ₹28L",
        "category": "Data",
        "apply_links": [
            {"platform": "LinkedIn",  "url": "https://www.linkedin.com/jobs/search/?keywords=Data+Engineer&location=India"},
            {"platform": "Naukri",    "url": "https://www.naukri.com/data-engineer-jobs"},
            {"platform": "Indeed",    "url": "https://in.indeed.com/jobs?q=Data+Engineer"},
        ],
    },
    "Cloud Engineer": {
        "required": ["aws", "terraform", "linux", "networking"],
        "bonus":    ["kubernetes", "docker", "gcp", "azure", "ci/cd"],
        "description": "Architect and manage cloud infrastructure at scale.",
        "salary_range": "₹10L – ₹30L",
        "category": "Cloud",
        "apply_links": [
            {"platform": "LinkedIn",  "url": "https://www.linkedin.com/jobs/search/?keywords=Cloud+Engineer&location=India"},
            {"platform": "Naukri",    "url": "https://www.naukri.com/cloud-engineer-jobs"},
            {"platform": "Indeed",    "url": "https://in.indeed.com/jobs?q=Cloud+Engineer"},
        ],
    },
    "Security Engineer": {
        "required": ["cybersecurity", "networking", "linux"],
        "bonus":    ["penetration testing", "python", "oauth", "jwt"],
        "description": "Protect systems, networks, and applications from threats.",
        "salary_range": "₹8L – ₹25L",
        "category": "Security",
        "apply_links": [
            {"platform": "LinkedIn",  "url": "https://www.linkedin.com/jobs/search/?keywords=Security+Engineer&location=India"},
            {"platform": "Naukri",    "url": "https://www.naukri.com/security-engineer-jobs"},
            {"platform": "Indeed",    "url": "https://in.indeed.com/jobs?q=Security+Engineer"},
        ],
    },
    "LLM / AI Engineer": {
        "required": ["python", "llm", "machine learning"],
        "bonus":    ["pytorch", "tensorflow", "fastapi", "docker", "nlp"],
        "description": "Build AI-powered products using large language models.",
        "salary_range": "₹15L – ₹45L",
        "category": "Emerging",
        "apply_links": [
            {"platform": "LinkedIn",  "url": "https://www.linkedin.com/jobs/search/?keywords=AI+Engineer+LLM&location=India"},
            {"platform": "Naukri",    "url": "https://www.naukri.com/llm-engineer-jobs"},
            {"platform": "Indeed",    "url": "https://in.indeed.com/jobs?q=AI+Engineer+LLM"},
        ],
    },
    "Product Manager": {
        "required": ["product management", "agile", "jira"],
        "bonus":    ["scrum", "data visualization", "sql", "technical writing"],
        "description": "Define product strategy and lead cross-functional teams.",
        "salary_range": "₹10L – ₹35L",
        "category": "Management",
        "apply_links": [
            {"platform": "LinkedIn",  "url": "https://www.linkedin.com/jobs/search/?keywords=Product+Manager&location=India"},
            {"platform": "Naukri",    "url": "https://www.naukri.com/product-manager-jobs"},
            {"platform": "Indeed",    "url": "https://in.indeed.com/jobs?q=Product+Manager"},
        ],
    },
    "React Native Developer": {
        "required": ["react native", "javascript", "react"],
        "bonus":    ["typescript", "redux", "mobile development", "testing"],
        "description": "Build cross-platform mobile apps using React Native.",
        "salary_range": "₹7L – ₹20L",
        "category": "Mobile",
        "apply_links": [
            {"platform": "LinkedIn",  "url": "https://www.linkedin.com/jobs/search/?keywords=React+Native+Developer&location=India"},
            {"platform": "Naukri",    "url": "https://www.naukri.com/react-native-developer-jobs"},
            {"platform": "Indeed",    "url": "https://in.indeed.com/jobs?q=React+Native+Developer"},
        ],
    },
}


def recommend_jobs(
    resume_skills: List[Dict],
    skill_gaps: List[Dict],
) -> Dict:
    """
    Match the candidate's resume skills against role profiles.
    Returns ranked recommendations with fit % and gap summary.
    """
    resume_keys  = {s["skill"] for s in resume_skills}
    level_map    = {s["skill"]: s["level"] for s in resume_skills}
    gap_keys     = {g["skill"] for g in skill_gaps}
    recommendations = []

    for role_name, profile in JOB_PROFILES.items():
        required = profile["required"]
        bonus    = profile["bonus"]

        # Required skills match
        req_hit  = [s for s in required if s in resume_keys]
        req_miss = [s for s in required if s not in resume_keys]

        # Bonus skills match
        bon_hit  = [s for s in bonus if s in resume_keys]

        # Fit score: required skills are worth 70%, bonus 30%
        req_score = (len(req_hit) / max(len(required), 1)) * 70
        bon_score = (len(bon_hit) / max(len(bonus), 1))    * 30
        fit_pct   = round(req_score + bon_score)

        # Skills you'd still need to get to 100% fit
        skills_to_learn = req_miss + [s for s in bonus if s not in resume_keys][:3]

        # Already strong (advanced/expert and required)
        strong = [s for s in req_hit if level_map.get(s, "") in ("advanced", "expert")]

        recommendations.append({
            "role":             role_name,
            "fit_percent":      fit_pct,
            "category":         profile["category"],
            "description":      profile["description"],
            "salary_range":     profile["salary_range"],
            "matched_skills":   req_hit + bon_hit,
            "missing_required": req_miss,
            "skills_to_learn":  skills_to_learn[:5],
            "strong_in":        strong,
            "ready":            fit_pct >= 70,
            "almost_ready":     55 <= fit_pct < 70,
            "apply_links":      profile.get("apply_links", []),
        })

    # Sort: ready first, then by fit %
    recommendations.sort(key=lambda x: (-x["ready"], -x["fit_percent"]))

    top = recommendations[:8]
    ready_count  = sum(1 for r in top if r["ready"])
    almost_count = sum(1 for r in top if r["almost_ready"])

    return {
        "total_roles_analysed": len(JOB_PROFILES),
        "ready_now":            ready_count,
        "almost_ready":         almost_count,
        "recommendations":      top,
    }