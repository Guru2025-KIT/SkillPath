from pydantic import BaseModel
from typing import List, Optional, Dict, Any


class SkillItem(BaseModel):
    skill: str
    level: str
    years: Optional[int] = None
    category: str


class RequiredSkill(BaseModel):
    skill: str
    level: str = "intermediate"
    importance: str
    category: str


class SkillGap(BaseModel):
    skill: str
    current_level: str
    required_level: str
    gap_score: float
    importance: str
    category: str


class Resource(BaseModel):
    name: str
    url: str
    free: bool


class Module(BaseModel):
    id: str
    title: str
    skill_addressed: str
    type: str
    estimated_hours: int
    priority: str
    resources: List[Resource]
    learning_outcomes: List[str]
    prerequisites: List[str]


class Phase(BaseModel):
    phase: int
    phase_name: str
    duration_weeks: int
    description: str
    modules: List[Module]


class ReasoningTrace(BaseModel):
    gap_analysis_method: str
    pathway_logic: str
    priority_rationale: str


class AnalysisResponse(BaseModel):
    candidate_name: str
    target_role: str
    resume_skills: List[SkillItem]
    required_skills: List[RequiredSkill]
    skill_gaps: List[SkillGap]
    strengths: List[str]
    learning_pathway: List[Phase]
    overall_readiness_score: int
    estimated_total_weeks: int
    reasoning_trace: ReasoningTrace
