"""
SkillPath AI-Adaptive Onboarding Engine
Backend API v2.0  |  FastAPI + spaCy + NetworkX + Claude AI
"""

import logging
import os
import json as _json

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from services.parser import extract_text
from services.extractor import (
    extract_skills_from_text,
    extract_required_skills,
    compute_skill_gaps,
    compute_readiness_score,
    extract_candidate_name,
    extract_target_role,
)
from services.pathway import build_learning_pathway
from services.extras import (
    compute_ats_score,
    generate_resume_suggestions,
    build_weekly_roadmap,
    recommend_jobs,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="SkillPath API",
    description="AI-Adaptive Onboarding Engine — skill gap analysis & personalized learning pathways.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Core pipeline ──────────────────────────────────────────────────────────────

def run_analysis(resume_text: str, jd_text: str) -> dict:
    """Full pipeline — called by /analyze and /analyze-text."""

    candidate_name  = extract_candidate_name(resume_text)
    target_role     = extract_target_role(jd_text)
    logger.info(f"Candidate: {candidate_name} | Role: {target_role}")

    resume_skills   = extract_skills_from_text(resume_text)
    required_skills = extract_required_skills(jd_text)
    logger.info(f"Resume skills: {len(resume_skills)} | JD skills: {len(required_skills)}")

    gaps, strengths  = compute_skill_gaps(resume_skills, required_skills)
    pathway_result   = build_learning_pathway(gaps, resume_skills)
    readiness        = compute_readiness_score(gaps, len(required_skills))
    logger.info(f"Gaps: {len(gaps)} | Strengths: {len(strengths)} | Readiness: {readiness}%")

    # ── Extra features — computed inline so front-end gets everything in one call ──
    ats_result      = compute_ats_score(resume_text, resume_skills, required_skills, gaps)
    suggestions     = generate_resume_suggestions(
                          resume_text, resume_skills, required_skills,
                          gaps, candidate_name, target_role)
    weekly_roadmap  = build_weekly_roadmap(pathway_result["learning_pathway"])
    job_recs        = recommend_jobs(resume_skills, gaps)

    return {
        # ── Core results ──────────────────────────────────────────────────────
        "candidate_name":          candidate_name,
        "target_role":             target_role,
        "resume_skills":           resume_skills,
        "required_skills":         required_skills,
        "skill_gaps":              gaps,
        "strengths":               strengths,
        "learning_pathway":        pathway_result["learning_pathway"],
        "overall_readiness_score": readiness,
        "estimated_total_weeks":   pathway_result["estimated_total_weeks"],
        "reasoning_trace":         pathway_result["reasoning_trace"],
        # ── Extra features ────────────────────────────────────────────────────
        "ats_score":               ats_result,
        "resume_suggestions":      suggestions,
        "weekly_roadmap":          weekly_roadmap,
        "job_recommendations":     job_recs,
    }


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "SkillPath API v2.0"}


@app.post("/analyze")
async def analyze(
    resume: UploadFile = File(...),
    job_description: UploadFile = File(...),
):
    """Accept uploaded resume + JD files, return full analysis including all extra features."""
    logger.info(f"Analyze: resume={resume.filename}, jd={job_description.filename}")

    resume_text = extract_text(await resume.read(), resume.filename)
    jd_text     = extract_text(await job_description.read(), job_description.filename)

    if len(resume_text) < 50:
        raise HTTPException(400, "Resume text too short — please upload a valid resume.")
    if len(jd_text) < 50:
        raise HTTPException(400, "Job description too short — please upload a valid JD.")

    try:
        return JSONResponse(content=run_analysis(resume_text, jd_text))
    except Exception as e:
        logger.exception("Analysis failed")
        raise HTTPException(500, str(e))


@app.post("/analyze-text")
async def analyze_text(
    resume_text: str = Form(...),
    jd_text:     str = Form(...),
):
    """Accept raw text — useful for testing via Swagger UI."""
    if not resume_text.strip():
        raise HTTPException(400, "Resume text is empty.")
    if not jd_text.strip():
        raise HTTPException(400, "JD text is empty.")
    try:
        return JSONResponse(content=run_analysis(resume_text, jd_text))
    except Exception as e:
        logger.exception("Analysis failed")
        raise HTTPException(500, str(e))


@app.post("/interview-prep")
async def interview_prep(
    candidate_name:  str = Form(...),
    target_role:     str = Form(...),
    skill_gaps:      str = Form(...),
    strengths:       str = Form(...),
    readiness_score: int = Form(...),
):
    """
    Generate a personalised interview prep guide using Claude AI.
    Falls back to rule-based guide if ANTHROPIC_API_KEY is not set.
    """
    gaps_list      = _json.loads(skill_gaps)
    strengths_list = _json.loads(strengths)

    critical_gaps  = [g["skill"] for g in gaps_list if g.get("importance") == "critical"][:6]
    important_gaps = [g["skill"] for g in gaps_list if g.get("importance") == "important"][:4]
    top_strengths  = strengths_list[:6]

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")

    if not api_key:
        return JSONResponse(content=_fallback_interview_prep(
            target_role, critical_gaps, top_strengths
        ))

    prompt = f"""You are an expert technical interview coach preparing a candidate for a real interview.

Candidate: {candidate_name}
Target Role: {target_role}
Readiness Score: {readiness_score}/100
Critical Skill Gaps: {', '.join(critical_gaps) if critical_gaps else 'None'}
Important Skill Gaps: {', '.join(important_gaps) if important_gaps else 'None'}
Key Strengths: {', '.join(top_strengths) if top_strengths else 'None'}

Return ONLY valid JSON (no markdown, no backticks) with this exact structure:
{{
  "coaching_summary": "2-3 sentence personalised coaching overview",
  "technical_questions": [
    {{"question": "...", "skill": "...", "difficulty": "easy|medium|hard", "tip": "one-sentence tip"}}
  ],
  "behavioral_questions": [
    {{"question": "...", "framework": "STAR|CAR|PAR", "angle": "what the interviewer is testing"}}
  ],
  "gap_questions": [
    {{"question": "...", "skill": "...", "how_to_handle": "specific honest strategy"}}
  ],
  "quick_wins": ["actionable tip the candidate can do before the interview"]
}}

Rules: 5 technical Qs, 4 behavioral Qs, 3 gap Qs, 4 quick wins. Be specific, never generic."""

    try:
        import anthropic
        client  = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = message.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return JSONResponse(content=_json.loads(raw.strip()))
    except Exception as e:
        logger.exception("Claude interview prep failed — using fallback")
        return JSONResponse(content=_fallback_interview_prep(
            target_role, critical_gaps, top_strengths
        ))


def _fallback_interview_prep(role: str, gaps: list, strengths: list) -> dict:
    gap      = gaps[0]      if gaps      else "core technical skills"
    strength = strengths[0] if strengths else "your existing experience"
    return {
        "coaching_summary": (
            f"You're targeting {role}. Lead with {strength} in every answer. "
            f"When {gap} comes up, be upfront about where you are and show your learning plan. "
            f"Interviewers hire people who know themselves."
        ),
        "technical_questions": [
            {"question": f"Walk me through how you'd approach a problem requiring {gap}.",
             "skill": gap, "difficulty": "medium",
             "tip": "Focus on your thinking process, not just the answer."},
            {"question": "Describe the most technically complex thing you've shipped.",
             "skill": "engineering depth", "difficulty": "medium",
             "tip": "Specifics beat vague stories every time."},
            {"question": f"What's the difference between {gap} and something you know well?",
             "skill": gap, "difficulty": "hard",
             "tip": "Honest comparison shows intellectual integrity."},
            {"question": "How do you debug a production issue you've never seen before?",
             "skill": "problem solving", "difficulty": "medium",
             "tip": "Walk through your systematic process step by step."},
            {"question": "Tell me about a technical decision you'd make differently today.",
             "skill": "reflection", "difficulty": "easy",
             "tip": "Shows growth mindset — pick something real."},
        ],
        "behavioral_questions": [
            {"question": "Tell me about a project you're genuinely proud of.",
             "framework": "STAR", "angle": "Ownership and technical depth"},
            {"question": f"Give me an example of how you used {strength} to deliver measurable value.",
             "framework": "STAR", "angle": "Skill with business impact"},
            {"question": "Describe a time you disagreed with your team and what happened.",
             "framework": "CAR", "angle": "Collaboration and communication"},
            {"question": "Tell me about a time you had to learn something under pressure.",
             "framework": "PAR", "angle": "Adaptability and learning velocity"},
        ],
        "gap_questions": [
            {"question": f"We need strong {gap} skills from day one. How much hands-on experience do you have?",
             "skill": gap,
             "how_to_handle": "Be honest about your level. Name it clearly, then show your specific learning plan."},
            {"question": "What's the biggest gap between where you are now and what this role needs?",
             "skill": "self-awareness",
             "how_to_handle": "Name the gap before they do. Then pivot to your concrete plan to close it in 30-60 days."},
            {"question": "Why should we pick you over someone who already has all these skills?",
             "skill": "value proposition",
             "how_to_handle": f"Lead with {strength}, learning speed, and fresh perspective."},
        ],
        "quick_wins": [
            f"Build one small project using {gap} this week — a demo shows initiative",
            f"Prepare a crisp 90-second 'about me' connecting your {strength} to this role",
            "Research the company's engineering blog and prepare two thoughtful questions",
            f"Read the official {gap} docs intro so you can speak to it without hesitation",
        ]
    }