# SkillPath — AI-Adaptive Onboarding Engine

> **ARTPARK CodeForge Hackathon Submission**
> An adaptive learning engine that parses new hire capabilities via resume and job description, then dynamically maps a personalized training pathway using graph-based algorithms and NLP — no black-box AI, fully explainable.

---

## Table of Contents

- [Problem Statement](#problem-statement)
- [Solution Overview](#solution-overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Skill-Gap Analysis Logic](#skill-gap-analysis-logic)
- [Adaptive Pathing Algorithm](#adaptive-pathing-algorithm)
- [Setup & Running](#setup--running)
- [Running with Docker (Recommended)](#running-with-docker-recommended)
- [Running Locally (Dev Mode)](#running-locally-dev-mode)
- [API Reference](#api-reference)
- [Datasets Used](#datasets-used)
- [Evaluation Criteria Mapping](#evaluation-criteria-mapping)
- [Project Structure](#project-structure)

---

## Problem Statement

Corporate onboarding today uses static, one-size-fits-all training programs. This creates two costly failure modes:

- **Over-training experienced hires** — senior engineers sit through content they already know
- **Under-supporting beginners** — juniors get dropped into advanced modules without scaffolding

SkillPath solves this by generating a unique learning pathway for every individual, derived entirely from their actual documented skills versus actual role requirements.

---

## Solution Overview

SkillPath takes two documents as input:

- **Resume** (PDF, DOCX, or TXT) — what the candidate already knows
- **Job Description** (PDF, DOCX, or TXT) — what the role requires

The backend pipeline does five things with pure NLP and graph algorithms:

1. **Extracts skills** from the resume — with proficiency levels inferred from context signals and years of experience
2. **Extracts required skills** from the JD — with importance tiers (critical / important / nice-to-have)
3. **Computes gap scores** — using a level-delta formula weighted by importance
4. **Builds a dependency graph** — topological sort ensures prerequisites are taught first
5. **Generates a phased pathway** — modules binned by priority, with real course links from a curated catalog

The result is rendered as an interactive dashboard with four tabs: Pathway, Gaps, Skills, and Reasoning Trace.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Browser  (React 18)                    │
│   ┌──────────────┐        ┌──────────────────────────┐   │
│   │  Upload Page  │        │     Results Dashboard    │   │
│   │  (Dropzone)  │        │  Pathway / Gaps / Skills │   │
│   └──────┬───────┘        └──────────────────────────┘   │
└──────────┼───────────────────────────────────────────────┘
           │  POST /analyze  (multipart/form-data)
           ▼
┌──────────────────────────────────────────────────────────┐
│                FastAPI Backend  (Python 3.11)             │
│                                                           │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────┐  │
│  │ File Parser   │   │  Extractor   │   │  Pathway    │  │
│  │ PDF/DOCX/TXT │──▶│  NLP engine  │──▶│  Generator  │  │
│  └──────────────┘   └──────────────┘   └─────────────┘  │
│                           │                   │           │
│                    Skill Taxonomy         NetworkX        │
│                    (JSON, 55 skills)      Dep. Graph      │
└──────────────────────────────────────────────────────────┘
```

### End-to-End Data Flow

```
Resume + JD files
      │
      ▼
File Parsing ──── PyPDF2 / docx2txt / UTF-8 decode
      │
      ▼
Skill Extraction ─── alias lookup across 55-skill taxonomy
      │              + context-window level inference
      ▼
Gap Computation ──── gap_score = level_delta × 2.5 × importance_weight
      │
      ▼
Dependency Graph ─── NetworkX DiGraph, topological sort
      │
      ▼
Phase Assignment ──── 4-tier binning: critical → important → proficiency → mastery
      │
      ▼
Course Matching ───── curated catalog lookup per skill × level
      │
      ▼
JSON Response ──────── React dashboard renders tabs
```

---

## Tech Stack

### Backend

| Component        | Technology         | Version  | Purpose                                |
|------------------|--------------------|----------|----------------------------------------|
| Web Framework    | FastAPI            | 0.111.0  | REST API, file uploads                 |
| ASGI Server      | Uvicorn            | 0.30.1   | Production server                      |
| NLP              | spaCy              | 3.7.5    | Text processing, entity support        |
| Graph Algorithm  | NetworkX           | 3.3      | Dependency graph, topological sort     |
| ML Utilities     | scikit-learn       | 1.5.1    | TF-IDF vectorizer (skill scoring)      |
| Numerics         | NumPy              | 1.26.4   | Gap score computations                 |
| PDF Parsing      | PyPDF2             | 3.0.1    | Text extraction from PDFs              |
| DOCX Parsing     | docx2txt           | 0.8      | Text extraction from Word docs         |
| Data Validation  | Pydantic           | 2.7.4    | Request/response schemas               |
| Language         | Python             | 3.11     |                                        |

### Frontend

| Component        | Technology         | Version  | Purpose                                |
|------------------|--------------------|----------|----------------------------------------|
| UI Framework     | React              | 18.3.1   | Component rendering                    |
| Routing          | React Router DOM   | 6.24.1   | SPA navigation                         |
| HTTP Client      | Axios              | 1.7.2    | API calls with timeout handling        |
| Charts           | Recharts           | 2.12.7   | Radar chart, bar chart                 |
| File Dropzone    | React Dropzone     | 14.2.3   | Drag-and-drop file upload              |
| Language         | JavaScript ES2022  | —        |                                        |

### Infrastructure

| Component        | Technology         | Notes                                  |
|------------------|--------------------|----------------------------------------|
| Containerization | Docker             | One Dockerfile per service             |
| Orchestration    | Docker Compose     | Single `docker-compose up` startup     |
| Frontend Serving | Nginx (Alpine)     | Multi-stage build, SPA routing         |

---

## Skill-Gap Analysis Logic

All intelligence is implemented in `backend/services/extractor.py`. No language model is used.

### Step 1 — Text Extraction

Documents are parsed into plain text using:
- `PyPDF2.PdfReader` for PDFs (page-by-page)
- `docx2txt.process()` for Word documents
- UTF-8 decode for plain text

### Step 2 — Skill Extraction via Alias Matching

The taxonomy (`data/skill_taxonomy.json`) defines 55 canonical skills, each with a list of known aliases. For example:

```json
"kubernetes": {
  "aliases": ["k8s", "kubectl", "helm", "kubernetes orchestration"],
  "prerequisites": ["docker"]
}
```

Extraction works by:
1. Normalizing the document text (lowercase, strip punctuation)
2. Building a reverse alias map: `alias → canonical_key`
3. Sorting aliases by length descending (so "machine learning" matches before "learning")
4. Regex word-boundary matching for each alias in the normalized text

### Step 3 — Proficiency Level Inference

For each matched skill, proficiency is inferred using two signals:

**a) Years of experience detection:**
```
Pattern: "3 years of Python", "Python (5+ yrs)", "4+ years experience with React"
Mapping: 0y → beginner, 1y → intermediate, 3y → advanced, 5y+ → expert
```

**b) Context-window signal words** (checked within ±80 chars of each skill mention):
```
expert:       "expert", "extensive", "deep expertise", "lead", "architect"
advanced:     "advanced", "senior", "strong", "proficient", "hands-on"
intermediate: "working knowledge", "familiar with", "experience with"
beginner:     "basic", "exposure to", "learning", "fundamental"
```

### Step 4 — Gap Score Formula

```
gap_score = min(10, level_delta × 2.5 × importance_weight)

level_delta        = required_level_index - current_level_index
                     (LEVEL_ORDER: none=0, beginner=1, intermediate=2, advanced=3, expert=4)

importance_weight  = critical → 1.0
                     important → 0.75
                     nice-to-have → 0.45
```

Example: candidate has `beginner` Python, JD requires `advanced`, marked `critical`:
```
gap_score = (3 - 1) × 2.5 × 1.0 = 5.0
```

### Step 5 — Readiness Score

```
readiness = 100 − (actual_weighted_penalty / max_possible_penalty × 100)
clamped to [5, 95]
```

Where `actual_weighted_penalty = Σ(importance_weight × gap_score)` over all gaps.

---

## Adaptive Pathing Algorithm

Implemented in `backend/services/pathway.py` using NetworkX. Fully original — no pre-built recommendation engine.

### Dependency Graph Construction

```python
G = nx.DiGraph()
# For each gap skill, add edges for its prerequisites:
# edge (docker → kubernetes) means "docker must be learned before kubernetes"
```

The graph includes not only the gap skills but any prerequisite chain needed to reach them. Topological sort then gives a valid learning order.

### Phase Assignment Rules

| Phase | Name              | Criteria                                            |
|-------|-------------------|-----------------------------------------------------|
| 1     | Core Foundations  | `importance == critical` AND `gap_score >= 6`       |
| 2     | Skill Consolidation | `importance in (critical, important)` AND `gap_score >= 3` |
| 3     | Role Proficiency  | `importance == important` AND `gap_score < 6`       |
| 4     | Advanced Mastery  | Everything else (nice-to-have, low-gap)             |

Within each phase, modules are sorted by `gap_score` descending — highest urgency first.

### Course Catalog Matching

Each module is matched to the curated course catalog by:
1. Finding all catalog entries where `entry.skill == gap_skill`
2. Scoring them: prefer `from_level` matching the candidate's current level
3. Breaking ties by minimizing `abs(entry.target_level_index − required_level_index)`

### Reasoning Trace

Every analysis returns a fully human-readable `reasoning_trace` with three fields explaining:
- How gaps were identified (formula, counts)
- Why this phase order was chosen (topological order, edge list)
- Why certain modules are high priority (scoring rationale, time estimate)

This is displayed in the dedicated "Reasoning" tab of the UI.

---

## Setup & Running

### Prerequisites

- **Docker Desktop** (recommended) OR Node.js 20+ and Python 3.11+
- No API keys required — zero external services

---

## Running with Docker (Recommended)

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/skillpath.git
cd skillpath

# 2. Build and start
docker-compose up --build
```

Open your browser:
- **App** → http://localhost:3000
- **API** → http://localhost:8000
- **Swagger Docs** → http://localhost:8000/docs

Stop everything:
```bash
docker-compose down
```

---

## Running Locally (Dev Mode)

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt
python -m spacy download en_core_web_sm

uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps
REACT_APP_API_URL=http://localhost:8000 npm start
```

App opens at http://localhost:3000.

---

## API Reference

### `GET /health`
Returns service status.
```json
{ "status": "ok", "service": "SkillPath API v1.0" }
```

---

### `POST /analyze`
**Content-Type:** `multipart/form-data`

| Field            | Type   | Description                        |
|------------------|--------|------------------------------------|
| `resume`         | File   | Resume (PDF, DOCX, or TXT)         |
| `job_description`| File   | Job description (PDF, DOCX, or TXT)|

Returns full analysis JSON including skills, gaps, pathway, readiness score, and reasoning trace.

---

### `POST /analyze-text`
**Content-Type:** `application/x-www-form-urlencoded`

| Field         | Type   | Description                |
|---------------|--------|----------------------------|
| `resume_text` | string | Raw resume text            |
| `jd_text`     | string | Raw job description text   |

Useful for testing without file uploads. Try it at `/docs`.

---

## Datasets Used

The following public datasets were used to build and validate the skill taxonomy, alias lists, and importance heuristics:

| Dataset                   | Source                                                                 | How Used                                                     |
|---------------------------|------------------------------------------------------------------------|--------------------------------------------------------------|
| O*NET Database (28.2)     | [onetcenter.org](https://www.onetcenter.org/db_releases.html)          | Canonical skill names, role-skill importance tiers, taxonomy structure |
| Resume Dataset            | [Kaggle / snehaanbhawal](https://www.kaggle.com/datasets/snehaanbhawal/resume-dataset/data) | Validated alias lists, tested extraction recall |
| Jobs & Job Descriptions   | [Kaggle / kshitizregmi](https://www.kaggle.com/datasets/kshitizregmi/jobs-and-job-description) | JD phrasing patterns, signal word calibration |

> No dataset is bundled in the runtime binary. They were used during development to build the taxonomy JSON and calibrate the context-window signal words in `extractor.py`.

---

## Evaluation Criteria Mapping

| Criterion                          | Weight | How SkillPath Addresses It                                                                                  |
|------------------------------------|--------|-------------------------------------------------------------------------------------------------------------|
| **Technical Sophistication**       | 20%    | Gap scoring formula, NetworkX dependency graph, topological sort, 4-tier phase binning, catalog matching    |
| **Grounding and Reliability**      | 15%    | Zero hallucination risk — no LLM used; all output is deterministic, derived only from provided documents   |
| **Reasoning Trace**                | 10%    | `reasoning_trace` object in every response with formula details, graph stats, and priority rationale         |
| **Product Impact**                 | 10%    | Strengths excluded from pathway; only gaps trained; estimated hours and weeks shown per module              |
| **User Experience**                | 15%    | Dark-mode dashboard, drag-drop upload, expandable phase timeline, bar/radar charts, module resource links   |
| **Cross-Domain Scalability**       | 10%    | No hardcoded role assumptions; driven entirely by JD text; works for software, ops, finance, HR, and more   |
| **Communication & Documentation**  | 20%    | This README, inline docstrings, 5-slide deck (`docs/presentation.html`), demo video                        |

---

## Project Structure

```
skillpath/
├── backend/
│   ├── data/
│   │   └── skill_taxonomy.json      # 55-skill taxonomy with aliases, prereqs, course catalog
│   ├── models/
│   │   └── schemas.py               # Pydantic request/response models
│   ├── services/
│   │   ├── extractor.py             # NLP skill extraction, gap scoring, readiness
│   │   ├── parser.py                # File text extraction (PDF/DOCX/TXT)
│   │   └── pathway.py               # Graph-based adaptive pathway generator
│   ├── main.py                      # FastAPI app, endpoints, pipeline orchestration
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── App.js                   # Router
│   │   ├── index.js                 # Entry point
│   │   ├── index.css                # Global CSS design system
│   │   └── pages/
│   │       ├── UploadPage.js        # Drag-drop file upload UI
│   │       ├── UploadPage.css
│   │       └── ResultsPage.js       # Dashboard: pathway, gaps, skills, reasoning
│   ├── package.json
│   ├── nginx.conf
│   └── Dockerfile
│
├── docs/
│   └── presentation.html            # 5-slide interactive deck (open in browser)
│
├── docker-compose.yml
├── .gitignore
└── README.md
```

---

## License

MIT — free to use, modify, and distribute.

---

*Built for the ARTPARK CodeForge Hackathon.*
