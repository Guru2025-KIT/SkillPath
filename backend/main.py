"""
SkillPath AI-Adaptive Onboarding Engine
Backend API — FastAPI
"""

import logging
import os
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import anthropic

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

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="SkillPath API",
    description="AI-Adaptive Onboarding Engine — skill gap analysis and personalized learning pathways.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def run_analysis(resume_text: str, jd_text: str) -> dict:
    candidate_name = extract_candidate_name(resume_text)
    target_role = extract_target_role(jd_text)
    logger.info(f"Candidate: {candidate_name} | Role: {target_role}")

    resume_skills = extract_skills_from_text(resume_text)
    logger.info(f"Resume skills found: {len(resume_skills)}")

    required_skills = extract_required_skills(jd_text)
    logger.info(f"JD required skills: {len(required_skills)}")

    gaps, strengths = compute_skill_gaps(resume_skills, required_skills)
    logger.info(f"Gaps: {len(gaps)} | Strengths: {len(strengths)}")

    pathway_result = build_learning_pathway(gaps, resume_skills)
    readiness = compute_readiness_score(gaps, len(required_skills))

    return {
        "candidate_name": candidate_name,
        "target_role": target_role,
        "resume_skills": resume_skills,
        "required_skills": required_skills,
        "skill_gaps": gaps,
        "strengths": strengths,
        "learning_pathway": pathway_result["learning_pathway"],
        "overall_readiness_score": readiness,
        "estimated_total_weeks": pathway_result["estimated_total_weeks"],
        "reasoning_trace": pathway_result["reasoning_trace"],
    }


@app.get("/health")
def health():
    return {"status": "ok", "service": "SkillPath API v2.0"}


@app.post("/analyze")
async def analyze(
    resume: UploadFile = File(...),
    job_description: UploadFile = File(...),
):
    logger.info(f"Analyze request: resume={resume.filename}, jd={job_description.filename}")

    resume_bytes = await resume.read()
    jd_bytes = await job_description.read()

    resume_text = extract_text(resume_bytes, resume.filename)
    jd_text = extract_text(jd_bytes, job_description.filename)

    if len(resume_text) < 50:
        raise HTTPException(status_code=400, detail="Resume text is too short. Please upload a valid resume.")
    if len(jd_text) < 50:
        raise HTTPException(status_code=400, detail="Job description text is too short. Please upload a valid JD.")

    try:
        result = run_analysis(resume_text, jd_text)
        return JSONResponse(content=result)
    except Exception as e:
        logger.exception("Analysis failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze-text")
async def analyze_text(
    resume_text: str = Form(...),
    jd_text: str = Form(...),
):
    if not resume_text.strip():
        raise HTTPException(status_code=400, detail="Resume text is empty.")
    if not jd_text.strip():
        raise HTTPException(status_code=400, detail="JD text is empty.")
    try:
        result = run_analysis(resume_text, jd_text)
        return JSONResponse(content=result)
    except Exception as e:
        logger.exception("Analysis failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/interview-prep")
async def interview_prep(
    candidate_name: str = Form(...),
    target_role: str = Form(...),
    skill_gaps: str = Form(...),   # JSON string
    strengths: str = Form(...),    # JSON string
    readiness_score: int = Form(...),
):
    """
    Use Claude to generate a personalized interview prep guide:
    - Behavioral questions based on strengths
    - Technical questions targeting gap areas
    - Red-flag questions the candidate should prepare for
    - Coaching tips
    """
    import json as _json

    gaps_list = _json.loads(skill_gaps)
    strengths_list = _json.loads(strengths)

    critical_gaps = [g["skill"] for g in gaps_list if g.get("importance") == "critical"][:6]
    important_gaps = [g["skill"] for g in gaps_list if g.get("importance") == "important"][:4]
    top_strengths = strengths_list[:6]

    prompt = f"""You are an expert technical interview coach preparing a candidate for a job interview.

Candidate: {candidate_name}
Target Role: {target_role}
Readiness Score: {readiness_score}/100
Critical Skill Gaps: {', '.join(critical_gaps) if critical_gaps else 'None'}
Important Skill Gaps: {', '.join(important_gaps) if important_gaps else 'None'}
Key Strengths: {', '.join(top_strengths) if top_strengths else 'None'}

Generate a comprehensive interview preparation guide. Return ONLY valid JSON with this exact structure:
{{
  "coaching_summary": "2-3 sentence personalized coaching overview for this specific candidate and role",
  "technical_questions": [
    {{"question": "...", "skill": "...", "difficulty": "easy|medium|hard", "tip": "how to answer this well in 1 sentence"}}
  ],
  "behavioral_questions": [
    {{"question": "...", "framework": "STAR|CAR|PAR", "angle": "what they're testing"}}
  ],
  "gap_questions": [
    {{"question": "...", "skill": "...", "how_to_handle": "honest strategy to answer this gap question"}}
  ],
  "quick_wins": [
    "specific actionable tip the candidate can implement before the interview"
  ]
}}

Requirements:
- 5 technical questions targeting the gap skills
- 4 behavioral questions leveraging the strengths  
- 3 gap questions (questions about weak areas with honest coaching on how to address them)
- 4 quick win tips
- Be specific to the role and skills, not generic"""

    try:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            # Return mock data if no API key configured
            return JSONResponse(content=_get_mock_interview_prep(target_role, critical_gaps, top_strengths))

        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = message.content[0].text.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = _json.loads(raw.strip())
        return JSONResponse(content=result)
    except Exception as e:
        logger.exception("Interview prep generation failed")
        return JSONResponse(content=_get_mock_interview_prep(target_role, critical_gaps, top_strengths))


def _get_mock_interview_prep(role, gaps, strengths):
    """Fallback when no API key is set."""
    gap_str = gaps[0] if gaps else "core technical skills"
    strength_str = strengths[0] if strengths else "your existing skills"
    return {
        "coaching_summary": f"You're applying for {role}. Focus your prep on demonstrating {strength_str} while being honest about your {gap_str} growth journey. Interviewers value self-awareness and a clear plan over pretending gaps don't exist.",
        "technical_questions": [
            {"question": f"Walk me through how you'd architect a solution using {gap_str}.", "skill": gap_str, "difficulty": "medium", "tip": "Focus on your thought process and what you'd research first."},
            {"question": "Describe the most complex technical problem you've solved recently.", "skill": "problem solving", "difficulty": "medium", "tip": "Use STAR format, emphasize the impact."},
            {"question": "How do you stay current with new technologies in your field?", "skill": "learning agility", "difficulty": "easy", "tip": "Mention specific resources: blogs, courses, side projects."},
            {"question": f"What's the difference between {gap_str} and similar technologies you know?", "skill": gap_str, "difficulty": "hard", "tip": "Honest comparison shows depth of understanding."},
            {"question": "Tell me about a time you had to learn something quickly under pressure.", "skill": "adaptability", "difficulty": "medium", "tip": "Pick an example where the outcome was positive."},
        ],
        "behavioral_questions": [
            {"question": "Tell me about a project you're most proud of.", "framework": "STAR", "angle": "Technical depth and ownership"},
            {"question": "Describe a conflict with a teammate and how you resolved it.", "framework": "CAR", "angle": "Collaboration and communication"},
            {"question": f"Give an example of how you used {strength_str} to deliver value.", "framework": "STAR", "angle": "Skill demonstration with business impact"},
            {"question": "Tell me about a time you failed and what you learned.", "framework": "PAR", "angle": "Self-awareness and growth mindset"},
        ],
        "gap_questions": [
            {"question": f"We require strong {gap_str} experience. How much have you used it?", "skill": gap_str, "how_to_handle": "Be honest about your current level, show your learning plan, and highlight transferable skills."},
            {"question": "What areas do you feel you still need to grow in for this role?", "skill": "self-awareness", "how_to_handle": "Name the gap confidently, then immediately pivot to your concrete plan to close it."},
            {"question": "Why should we hire you over someone with more experience in these areas?", "skill": "value proposition", "how_to_handle": "Lead with your strengths and learning velocity — fresh perspectives often outperform stale experience."},
        ],
        "quick_wins": [
            f"Build a small project using {gap_str} this week — even a TODO app shows initiative",
            "Prepare a 2-minute 'about me' story that connects your background directly to this role",
            f"Read the official {gap_str} documentation introduction so you can speak to it confidently",
            "Research the company's tech stack and prepare 3 thoughtful questions about their engineering challenges",
        ]
    }