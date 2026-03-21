import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  RadarChart, PolarGrid, PolarAngleAxis,
  Radar, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
 
/* ─── palette helpers ─────────────────────────────────────────────────────── */
const LEVEL_ORDER = ['none', 'beginner', 'intermediate', 'advanced', 'expert'];
const levelNum = l => Math.max(0, LEVEL_ORDER.indexOf(l));
const importanceColor = imp =>
  imp === 'critical' ? '#f87171' : imp === 'important' ? '#fbbf24' : '#34d399';
const gapBarColor = score =>
  score >= 7 ? '#f87171' : score >= 4 ? '#fbbf24' : '#34d399';
const scoreColor = s => s >= 70 ? '#34d399' : s >= 45 ? '#fbbf24' : '#f87171';
const diffColor = d => d === 'hard' ? '#f87171' : d === 'medium' ? '#fbbf24' : '#34d399';
const typeColor = {
  course:     { bg: 'rgba(92,110,248,.12)', c: '#9b8dfc', b: 'rgba(92,110,248,.25)' },
  workshop:   { bg: 'rgba(45,212,191,.1)',  c: '#2dd4bf', b: 'rgba(45,212,191,.25)' },
  project:    { bg: 'rgba(52,211,153,.1)',  c: '#34d399', b: 'rgba(52,211,153,.2)'  },
  assessment: { bg: 'rgba(251,191,36,.1)',  c: '#fbbf24', b: 'rgba(251,191,36,.2)'  },
  reading:    { bg: 'rgba(255,255,255,.05)',c: '#8888aa', b: 'rgba(255,255,255,.1)' },
};
const frameworkColor = { STAR: '#9b8dfc', CAR: '#2dd4bf', PAR: '#fbbf24' };

/* ─── style primitives ────────────────────────────────────────────────────── */
const pill = imp => ({
  display:'inline-flex', alignItems:'center', fontSize:10, padding:'2px 8px',
  borderRadius:100, fontFamily:'var(--fm)', letterSpacing:.4,
  background: imp==='critical' ? 'rgba(248,113,113,.1)' : imp==='important' ? 'rgba(251,191,36,.1)' : 'rgba(52,211,153,.08)',
  color: importanceColor(imp), border:`1px solid ${importanceColor(imp)}44`,
});
const typePill = type => {
  const c = typeColor[type] || typeColor.reading;
  return { display:'inline-block', fontSize:10, padding:'2px 8px', borderRadius:100,
    fontFamily:'var(--fm)', background:c.bg, color:c.c, border:`1px solid ${c.b}` };
};
const card = {
  background:'var(--surface)', border:'1px solid var(--border)',
  borderRadius:'var(--r)', padding:24,
};
const sectionTitle = {
  fontFamily:'var(--fd)', fontSize:11, fontWeight:700,
  letterSpacing:.8, textTransform:'uppercase', color:'var(--text3)',
  marginBottom:16, display:'flex', alignItems:'center', gap:8,
};
const rowDivider = { borderBottom:'1px solid var(--border)' };

/* ─── TABS ────────────────────────────────────────────────────────────────── */
const TABS = [
  { id:'pathway',     label:'🗺 Pathway'     },
  { id:'gaps',        label:'⚡ Gaps'        },
  { id:'skills',      label:'📊 Skills'      },
  { id:'timeline',    label:'📅 Timeline'    },
  { id:'interview',   label:'🎯 Interview'   },
  { id:'ats',         label:'🤖 ATS Score'   },
  { id:'resume-tips', label:'✍️ Resume Tips'  },
  { id:'roadmap',     label:'📆 Roadmap'     },
  { id:'jobs',        label:'💼 Jobs'        },
  { id:'reasoning',   label:'🧠 Reasoning'   },
];

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function ResultsPage({ data, onReset }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('pathway');
  const [openPhase, setOpenPhase] = useState(0);
  const [interviewData, setInterviewData] = useState(null);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const printRef = useRef();

  const {
    candidate_name   = 'Candidate',
    target_role      = 'Target Role',
    resume_skills    = [],
    required_skills  = [],
    skill_gaps       = [],
    strengths        = [],
    learning_pathway = [],
    overall_readiness_score = 0,
    estimated_total_weeks   = 0,
    reasoning_trace  = {},
    ats_score        = null,
    resume_suggestions = null,
    weekly_roadmap   = null,
    job_recommendations = null,
  } = data;

  const totalModules = learning_pathway.reduce((s,p) => s+(p.modules?.length||0), 0);
  const totalHours   = learning_pathway.reduce((s,p) => s+(p.modules||[]).reduce((ms,m) => ms+(m.estimated_hours||0), 0), 0);
  const criticalGaps = skill_gaps.filter(g => g.importance==='critical').length;

  /* ── radar / bar data ─────────────────────────────────────────────────── */
  const radarData = resume_skills.slice(0,8).map(sk => ({
    skill: sk.skill.length>12 ? sk.skill.slice(0,11)+'…' : sk.skill,
    value: levelNum(sk.level) * 25,
  }));
  const barData = [...skill_gaps]
    .sort((a,b) => b.gap_score-a.gap_score).slice(0,10)
    .map(g => ({ skill: g.skill, score: g.gap_score, imp: g.importance }));

  /* ── category pie data ────────────────────────────────────────────────── */
  const catCounts = {};
  skill_gaps.forEach(g => { catCounts[g.category] = (catCounts[g.category]||0) + 1; });
  const PIE_COLORS = ['#9b8dfc','#2dd4bf','#f87171','#fbbf24','#34d399','#60a5fa','#f472b6','#a78bfa'];
  const pieData = Object.entries(catCounts).map(([name,value],i) => ({ name, value, fill: PIE_COLORS[i%PIE_COLORS.length] }));

  /* ── interview prep ───────────────────────────────────────────────────── */
  const loadInterviewPrep = useCallback(async () => {
    if (interviewData || interviewLoading) return;
    setInterviewLoading(true);
    try {
      const base = process.env.REACT_APP_API_URL || 'http://localhost:8000';
      const form = new FormData();
      form.append('candidate_name', candidate_name);
      form.append('target_role', target_role);
      form.append('skill_gaps', JSON.stringify(skill_gaps));
      form.append('strengths', JSON.stringify(strengths));
      form.append('readiness_score', overall_readiness_score);
      const { data: ip } = await axios.post(`${base}/interview-prep`, form, { timeout: 30000 });
      setInterviewData(ip);
    } catch(e) {
      console.error(e);
    } finally {
      setInterviewLoading(false);
    }
  }, [interviewData, interviewLoading, candidate_name, target_role, skill_gaps, strengths, overall_readiness_score]);

  const handleTabChange = (id) => {
    setTab(id);
    if (id === 'interview') loadInterviewPrep();
  };

  /* ── share / copy ─────────────────────────────────────────────────────── */
  const handleCopyShare = () => {
    const summary = `SkillPath Analysis for ${candidate_name}\nRole: ${target_role}\nReadiness: ${overall_readiness_score}%\nGaps: ${skill_gaps.length} (${criticalGaps} critical)\nTimeline: ${estimated_total_weeks} weeks\n\nGenerated by SkillPath`;
    navigator.clipboard.writeText(summary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  /* ── print/export ─────────────────────────────────────────────────────── */
  const handleExport = () => {
    window.print();
  };

  function handleReset() { onReset(); navigate('/'); }

  /* ── shared button style ─────────────────────────────────────────────── */
  const btnStyle = (variant='default') => ({
    background: variant==='accent' ? 'var(--accent)' : 'var(--surface)',
    border: `1px solid ${variant==='accent' ? 'var(--accent)' : 'var(--border2)'}`,
    color: variant==='accent' ? '#fff' : 'var(--text2)',
    padding:'7px 16px', borderRadius:8, fontSize:13, cursor:'pointer',
    display:'flex', alignItems:'center', gap:6,
  });

  return (
    <div ref={printRef} style={{ minHeight:'100vh', background:'var(--bg)', fontFamily:'var(--fb)' }}>
      <style>{`
        @media print {
          nav, .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
        }
        .interview-card { transition: transform .15s, box-shadow .15s; }
        .interview-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.3); }
        .gantt-bar { transition: opacity .15s; }
        .gantt-bar:hover { opacity: .85; }
      `}</style>

      {/* ── NAV ── */}
      <nav className="no-print" style={{
        padding:'18px 40px', borderBottom:'1px solid var(--border)',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        position:'sticky', top:0, background:'rgba(7,7,15,.93)',
        backdropFilter:'blur(14px)', zIndex:100,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:7,height:7,borderRadius:'50%',background:'var(--accent)',boxShadow:'0 0 8px var(--accent)' }}/>
          <span style={{ fontFamily:'var(--fd)', fontSize:19, fontWeight:800, letterSpacing:'-.5px' }}>
            Skill<span style={{ color:'var(--accent)' }}>Path</span>
          </span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={handleCopyShare} style={btnStyle()}>
            {copied ? '✓ Copied!' : '🔗 Share'}
          </button>
          <button onClick={handleExport} style={btnStyle()}>🖨 Export PDF</button>
          <button onClick={handleReset} style={btnStyle()}>← New Analysis</button>
        </div>
      </nav>

      <div style={{ maxWidth:1080, margin:'0 auto', padding:'40px 24px 80px' }}>

        {/* ── HERO ── */}
        <div className="fade-up" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:36, gap:24, flexWrap:'wrap' }}>
          <div>
            <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:'rgba(92,110,248,.1)',
              border:'1px solid rgba(92,110,248,.2)', color:'var(--accent2)', fontFamily:'var(--fm)',
              fontSize:10, letterSpacing:1.2, textTransform:'uppercase', padding:'4px 12px',
              borderRadius:100, marginBottom:10 }}>🎯 {target_role}</div>
            <h1 style={{ fontFamily:'var(--fd)', fontSize:30, fontWeight:800, letterSpacing:'-1px', marginBottom:4 }}>
              {candidate_name}
            </h1>
            <p style={{ fontSize:13, color:'var(--text2)' }}>Personalized pathway ready</p>
          </div>
          {/* Score ring */}
          <div style={{ ...card, display:'flex', flexDirection:'column', alignItems:'center', padding:'18px 28px', minWidth:120, position:'relative' }}>
            <svg width="80" height="80" style={{ transform:'rotate(-90deg)' }}>
              <circle cx="40" cy="40" r="34" fill="none" stroke="var(--border)" strokeWidth="6"/>
              <circle cx="40" cy="40" r="34" fill="none"
                stroke={scoreColor(overall_readiness_score)} strokeWidth="6"
                strokeDasharray={`${2*Math.PI*34}`}
                strokeDashoffset={`${2*Math.PI*34*(1-overall_readiness_score/100)}`}
                strokeLinecap="round" style={{ transition:'stroke-dashoffset .8s ease' }}/>
            </svg>
            <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-42%)',
              fontFamily:'var(--fd)', fontSize:22, fontWeight:800, color: scoreColor(overall_readiness_score) }}>
              {overall_readiness_score}
            </div>
            <div style={{ fontFamily:'var(--fm)', fontSize:10, color:'var(--text3)', textTransform:'uppercase', letterSpacing:1, marginTop:6 }}>
              Readiness %
            </div>
          </div>
        </div>

        {/* ── STAT BAND ── */}
        <div className="fade-up-1" style={{ display:'flex', gap:14, marginBottom:32, flexWrap:'wrap' }}>
          {[
            { v: skill_gaps.length,         k:'Skill Gaps',  e:'⚡' },
            { v: criticalGaps,              k:'Critical',    e:'🔴' },
            { v: strengths.length,          k:'Strengths',   e:'💪' },
            { v: learning_pathway.length,   k:'Phases',      e:'🗺' },
            { v: totalModules,              k:'Modules',     e:'📚' },
            { v: `${totalHours}h`,          k:'Est. Hours',  e:'⏱' },
            { v: `${estimated_total_weeks}w`,k:'Timeline',   e:'📅' },
          ].map(it => (
            <div key={it.k} style={{ ...card, flex:'1 1 100px', padding:'14px 18px' }}>
              <div style={{ fontSize:16, marginBottom:2 }}>{it.e}</div>
              <div style={{ fontFamily:'var(--fd)', fontSize:22, fontWeight:800, letterSpacing:-1 }}>{it.v}</div>
              <div style={{ fontFamily:'var(--fm)', fontSize:10, color:'var(--text3)', letterSpacing:.6, textTransform:'uppercase', marginTop:2 }}>{it.k}</div>
            </div>
          ))}
        </div>

        {/* ── TAB ROW ── */}
        <div className="fade-up-2 no-print" style={{ display:'flex', gap:3, marginBottom:28, background:'var(--surface)', padding:4, borderRadius:10, border:'1px solid var(--border)', flexWrap:'wrap' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => handleTabChange(t.id)} style={{
              padding:'8px 16px', borderRadius:8, fontFamily:'var(--fd)',
              fontSize:13, fontWeight: tab===t.id ? 700 : 400,
              color: tab===t.id ? '#fff' : 'var(--text2)',
              background: tab===t.id ? 'var(--accent)' : 'transparent',
              transition:'all .18s', whiteSpace:'nowrap',
            }}>{t.label}</button>
          ))}
        </div>

        {/* ══════ TAB: PATHWAY ══════ */}
        {tab==='pathway' && (
          <div className="fade-up">
            {learning_pathway.length === 0 && (
              <div style={{ ...card, color:'var(--text2)', fontSize:14 }}>
                🎉 No gaps detected — you're already qualified for this role!
              </div>
            )}
            {learning_pathway.map((phase, idx) => (
              <div key={phase.phase} style={{ display:'grid', gridTemplateColumns:'38px 1fr', marginBottom:0 }}>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                  <div onClick={() => setOpenPhase(openPhase===idx ? -1 : idx)} style={{
                    width:34, height:34, borderRadius:'50%', cursor:'pointer',
                    background: openPhase===idx ? 'var(--accent)' : 'var(--surface)',
                    border:`2px solid ${openPhase===idx ? 'var(--accent)' : 'var(--border2)'}`,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontFamily:'var(--fm)', fontSize:12, fontWeight:700,
                    color: openPhase===idx ? '#fff' : 'var(--text2)',
                    transition:'all .2s', flexShrink:0, zIndex:1,
                  }}>{phase.phase}</div>
                  {idx < learning_pathway.length-1 && (
                    <div style={{ width:2, flex:1, background:'var(--border)', minHeight:24 }}/>
                  )}
                </div>
                <div style={{ paddingLeft:20, paddingBottom: idx<learning_pathway.length-1 ? 28 : 0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:12, height:34, marginBottom: openPhase===idx ? 14 : 0 }}>
                    <span style={{ fontFamily:'var(--fd)', fontSize:17, fontWeight:700, letterSpacing:'-.4px' }}>
                      {phase.phase_name}
                    </span>
                    <span style={{ fontFamily:'var(--fm)', fontSize:11, color:'var(--text3)' }}>
                      {phase.duration_weeks}w · {phase.modules?.length} module{phase.modules?.length!==1?'s':''}
                    </span>
                  </div>
                  {openPhase===idx && (
                    <>
                      <p style={{ fontSize:13, color:'var(--text2)', marginBottom:16, lineHeight:1.65, maxWidth:680 }}>
                        {phase.description}
                      </p>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(272px,1fr))', gap:12 }}>
                        {(phase.modules||[]).map(mod => (
                          <div key={mod.id} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:10, padding:16 }}>
                            <div style={{ display:'flex', justifyContent:'space-between', gap:8, marginBottom:6 }}>
                              <div style={{ fontFamily:'var(--fd)', fontSize:13, fontWeight:700, lineHeight:1.3 }}>{mod.title}</div>
                              <span style={typePill(mod.type)}>{mod.type}</span>
                            </div>
                            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>{mod.skill_addressed}</div>
                            <div style={{ fontFamily:'var(--fm)', fontSize:11, color:'var(--text2)', marginBottom:10, display:'flex', gap:8 }}>
                              <span>⏱ {mod.estimated_hours}h</span>
                              <span style={{ color: mod.priority==='high' ? 'var(--red)' : mod.priority==='medium' ? 'var(--yellow)' : 'var(--green)' }}>
                                {mod.priority} priority
                              </span>
                            </div>
                            {mod.learning_outcomes?.length>0 && (
                              <div style={{ marginBottom:10 }}>
                                <div style={{ fontFamily:'var(--fm)', fontSize:10, color:'var(--text3)', letterSpacing:.6, textTransform:'uppercase', marginBottom:5 }}>Outcomes</div>
                                {mod.learning_outcomes.slice(0,2).map((o,i) => (
                                  <div key={i} style={{ fontSize:12, color:'var(--text2)', display:'flex', gap:5, marginBottom:2, lineHeight:1.4 }}>
                                    <span style={{ color:'var(--accent)' }}>›</span>{o}
                                  </div>
                                ))}
                              </div>
                            )}
                            {mod.resources?.length>0 && (
                              <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                                {mod.resources.slice(0,2).map((r,i) => (
                                  <a key={i} href={r.url} target="_blank" rel="noreferrer"
                                    style={{ fontSize:11, padding:'3px 8px', borderRadius:6,
                                      background:'var(--surface)', border:'1px solid var(--border2)',
                                      color:'var(--text2)', display:'inline-flex', alignItems:'center', gap:4 }}>
                                    {r.free ? '🆓' : '💳'} {r.name}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══════ TAB: GAPS ══════ */}
        {tab==='gaps' && (
          <div className="fade-up">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:20 }}>
              <div style={card}>
                <div style={sectionTitle}>⚡ Gap Details</div>
                {skill_gaps.length===0 && <p style={{ color:'var(--text2)', fontSize:14 }}>No gaps detected.</p>}
                {[...skill_gaps].sort((a,b) => b.gap_score-a.gap_score).map((g,i) => (
                  <div key={i} style={{ ...rowDivider, padding:'10px 0', display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ flex:1, fontSize:14, fontWeight:500 }}>{g.skill}</div>
                    <div style={{ fontFamily:'var(--fm)', fontSize:10, color:'var(--text3)', display:'flex', alignItems:'center', gap:5 }}>
                      <span>{g.current_level}</span>
                      <span style={{ color:'var(--accent)' }}>→</span>
                      <span style={{ color:'var(--accent2)' }}>{g.required_level}</span>
                    </div>
                    <div style={{ width:60, height:5, background:'var(--bg2)', borderRadius:3, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${g.gap_score*10}%`, background: gapBarColor(g.gap_score), borderRadius:3 }}/>
                    </div>
                    <span style={pill(g.importance)}>{g.importance}</span>
                  </div>
                ))}
              </div>
              <div style={{ ...card, display:'flex', flexDirection:'column' }}>
                <div style={sectionTitle}>📊 Gap Scores</div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={barData} layout="vertical" margin={{ left:8, right:16, top:0, bottom:0 }}>
                    <XAxis type="number" domain={[0,10]} tick={{ fill:'var(--text3)', fontSize:10, fontFamily:'var(--fm)' }} />
                    <YAxis dataKey="skill" type="category" width={90} tick={{ fill:'var(--text2)', fontSize:11, fontFamily:'var(--fm)' }} />
                    <Tooltip contentStyle={{ background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:8, fontSize:12 }} />
                    <Bar dataKey="score" radius={[0,4,4,0]}>
                      {barData.map((entry,i) => <Cell key={i} fill={gapBarColor(entry.score)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {/* Gap by category pie */}
            {pieData.length > 0 && (
              <div style={card}>
                <div style={sectionTitle}>🗂 Gaps by Category</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({name,value}) => `${name} (${value})`}>
                      {pieData.map((entry,i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:8, fontSize:12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ══════ TAB: SKILLS ══════ */}
        {tab==='skills' && (
          <div className="fade-up" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
            <div style={card}>
              <div style={sectionTitle}>✅ Resume Skills</div>
              {resume_skills.slice(0,14).map((sk,i) => (
                <div key={i} style={{ ...rowDivider, padding:'9px 0', display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ flex:1, fontSize:14, fontWeight:500 }}>{sk.skill}</div>
                  <div style={{ fontFamily:'var(--fm)', fontSize:11, color:'var(--text3)' }}>
                    {sk.years ? `${sk.years}y` : ''}
                  </div>
                  <div style={{ width:60, height:5, background:'var(--bg2)', borderRadius:3, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${levelNum(sk.level)*25}%`, background:'var(--accent)', borderRadius:3 }}/>
                  </div>
                  <span style={{ fontFamily:'var(--fm)', fontSize:10, color:'var(--accent2)' }}>{sk.level}</span>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
              {strengths.length>0 && (
                <div style={card}>
                  <div style={sectionTitle}>💪 Strengths</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                    {strengths.map((s,i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:7, background:'rgba(52,211,153,.07)',
                        border:'1px solid rgba(52,211,153,.18)', borderRadius:8, padding:'7px 12px', fontSize:13 }}>
                        <span style={{ color:'var(--green)', fontSize:11 }}>✓</span> {s}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {radarData.length > 2 && (
                <div style={card}>
                  <div style={sectionTitle}>📡 Skill Radar</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="rgba(255,255,255,.05)" />
                      <PolarAngleAxis dataKey="skill" tick={{ fill:'var(--text2)', fontSize:10, fontFamily:'var(--fm)' }} />
                      <Radar dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.18} strokeWidth={2} />
                      <Tooltip contentStyle={{ background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:8, fontSize:12 }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {/* Skill category breakdown */}
              <div style={card}>
                <div style={sectionTitle}>📁 Skill Coverage</div>
                {Object.entries(
                  resume_skills.reduce((acc, sk) => { acc[sk.category] = (acc[sk.category]||0)+1; return acc; }, {})
                ).sort((a,b) => b[1]-a[1]).slice(0,6).map(([cat,count],i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                    <div style={{ width:90, fontSize:11, color:'var(--text3)', textTransform:'capitalize' }}>{cat.replace('_',' ')}</div>
                    <div style={{ flex:1, height:6, background:'var(--bg2)', borderRadius:3, overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${Math.min(100,(count/resume_skills.length)*300)}%`, background:'var(--accent2)', borderRadius:3 }}/>
                    </div>
                    <div style={{ fontSize:11, color:'var(--text2)', width:20, textAlign:'right' }}>{count}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══════ TAB: TIMELINE ══════ */}
        {tab==='timeline' && (
          <div className="fade-up">
            <div style={{ ...card, marginBottom:20 }}>
              <div style={sectionTitle}>📅 Learning Timeline — Gantt View</div>
              <p style={{ fontSize:13, color:'var(--text3)', marginBottom:24 }}>
                {estimated_total_weeks} total weeks · {totalHours}h of learning · {totalModules} modules across {learning_pathway.length} phases
              </p>

              {learning_pathway.length === 0 && (
                <p style={{ color:'var(--text2)' }}>🎉 No learning required — you're job-ready!</p>
              )}

              {/* Week ruler */}
              {learning_pathway.length > 0 && (() => {
                const totalW = Math.max(estimated_total_weeks, 1);
                const PHASE_COLORS = ['#9b8dfc','#2dd4bf','#f87171','#fbbf24'];
                let cursor = 0;
                return (
                  <div>
                    {/* Ruler */}
                    <div style={{ display:'flex', marginLeft:140, marginBottom:8 }}>
                      {Array.from({length: totalW+1}, (_,i) => (
                        <div key={i} style={{ flex:1, fontSize:9, color:'var(--text3)', fontFamily:'var(--fm)', textAlign:'center',
                          borderLeft: i%2===0 ? '1px solid var(--border)' : 'none', paddingLeft:2 }}>
                          {i%2===0 ? `W${i}` : ''}
                        </div>
                      ))}
                    </div>
                    {/* Phase bars */}
                    {learning_pathway.map((phase, idx) => {
                      const start = cursor;
                      cursor += phase.duration_weeks;
                      const color = PHASE_COLORS[idx % PHASE_COLORS.length];
                      return (
                        <div key={phase.phase} style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
                          <div style={{ width:140, fontSize:12, color:'var(--text2)', fontFamily:'var(--fd)', fontWeight:600, paddingRight:12, flexShrink:0 }}>
                            Phase {phase.phase}
                            <div style={{ fontSize:10, color:'var(--text3)', fontWeight:400, marginTop:1 }}>{phase.phase_name}</div>
                          </div>
                          <div style={{ flex:1, position:'relative', height:32 }}>
                            <div style={{ position:'absolute', height:32, borderRadius:6,
                              left:`${(start/totalW)*100}%`,
                              width:`${(phase.duration_weeks/totalW)*100}%`,
                              background: `${color}22`,
                              border:`1.5px solid ${color}`,
                              display:'flex', alignItems:'center', paddingLeft:8,
                              fontSize:11, color, fontFamily:'var(--fm)' }}
                              className="gantt-bar">
                              {phase.duration_weeks}w · {phase.modules?.length} modules
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {/* Module-level detail */}
                    <div style={{ marginTop:32 }}>
                      <div style={{ ...sectionTitle, marginBottom:12 }}>📚 Module Breakdown</div>
                      {learning_pathway.map((phase, pidx) => (
                        <div key={phase.phase} style={{ marginBottom:16 }}>
                          <div style={{ fontSize:12, color:'var(--text3)', fontFamily:'var(--fm)', marginBottom:6,
                            textTransform:'uppercase', letterSpacing:.8 }}>
                            Phase {phase.phase} — {phase.phase_name}
                          </div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                            {(phase.modules||[]).map((mod,i) => (
                              <div key={i} style={{ background:'var(--bg2)', border:`1px solid ${PHASE_COLORS[pidx%PHASE_COLORS.length]}33`,
                                borderRadius:8, padding:'8px 12px', fontSize:12 }}>
                                <span style={{ color: PHASE_COLORS[pidx%PHASE_COLORS.length] }}>●</span>{' '}
                                {mod.skill_addressed} <span style={{ color:'var(--text3)' }}>({mod.estimated_hours}h)</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Effort pie */}
            {learning_pathway.length > 0 && (
              <div style={card}>
                <div style={sectionTitle}>⏱ Hours by Phase</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={learning_pathway.map((p,i) => ({
                        name: p.phase_name,
                        value: (p.modules||[]).reduce((s,m) => s+(m.estimated_hours||0), 0),
                        fill: ['#9b8dfc','#2dd4bf','#f87171','#fbbf24'][i%4]
                      }))}
                      dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                      label={({name,value}) => `${name}: ${value}h`}>
                      {learning_pathway.map((_,i) => (
                        <Cell key={i} fill={['#9b8dfc','#2dd4bf','#f87171','#fbbf24'][i%4]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background:'var(--surface)', border:'1px solid var(--border2)', borderRadius:8, fontSize:12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* ══════ TAB: INTERVIEW PREP ══════ */}
        {tab==='interview' && (
          <div className="fade-up">
            {interviewLoading && (
              <div style={{ ...card, display:'flex', flexDirection:'column', alignItems:'center', padding:60, gap:16 }}>
                <div style={{ width:40,height:40,borderRadius:'50%',border:'3px solid var(--border)',borderTopColor:'var(--accent)',animation:'spin 1s linear infinite' }}/>
                <div style={{ color:'var(--text2)', fontSize:14 }}>Generating personalized interview prep with AI…</div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
            {!interviewLoading && !interviewData && (
              <div style={{ ...card, textAlign:'center', padding:48 }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🎯</div>
                <div style={{ fontFamily:'var(--fd)', fontSize:18, marginBottom:8 }}>Interview Prep</div>
                <div style={{ color:'var(--text2)', fontSize:14, marginBottom:20 }}>
                  AI-generated questions tailored to your gaps and strengths.
                </div>
                <button onClick={loadInterviewPrep} style={{ ...btnStyle('accent'), margin:'0 auto' }}>
                  Generate My Interview Prep
                </button>
              </div>
            )}
            {interviewData && (
              <>
                {/* Coaching summary */}
                <div style={{ ...card, marginBottom:20, borderLeft:'3px solid var(--accent)' }}>
                  <div style={sectionTitle}>🧑‍💼 Coaching Summary</div>
                  <p style={{ fontSize:14, color:'var(--text2)', lineHeight:1.7 }}>{interviewData.coaching_summary}</p>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:20 }}>
                  {/* Technical questions */}
                  <div style={card}>
                    <div style={sectionTitle}>💻 Technical Questions</div>
                    {(interviewData.technical_questions||[]).map((q,i) => (
                      <div key={i} className="interview-card" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:10, padding:14, marginBottom:10 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                          <span style={{ fontFamily:'var(--fm)', fontSize:10, color:'var(--text3)', textTransform:'uppercase', letterSpacing:.6 }}>{q.skill}</span>
                          <span style={{ fontFamily:'var(--fm)', fontSize:10, padding:'1px 8px', borderRadius:100,
                            color: diffColor(q.difficulty), background:`${diffColor(q.difficulty)}15`,
                            border:`1px solid ${diffColor(q.difficulty)}33` }}>{q.difficulty}</span>
                        </div>
                        <div style={{ fontSize:13, fontWeight:500, marginBottom:8, lineHeight:1.5 }}>Q: {q.question}</div>
                        <div style={{ fontSize:12, color:'var(--accent)', display:'flex', gap:5, lineHeight:1.4 }}>
                          <span>💡</span><span>{q.tip}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Behavioral questions */}
                  <div style={card}>
                    <div style={sectionTitle}>🧠 Behavioral Questions</div>
                    {(interviewData.behavioral_questions||[]).map((q,i) => (
                      <div key={i} className="interview-card" style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:10, padding:14, marginBottom:10 }}>
                        <div style={{ display:'flex', gap:6, marginBottom:6 }}>
                          <span style={{ fontFamily:'var(--fm)', fontSize:10, padding:'1px 8px', borderRadius:100,
                            color: frameworkColor[q.framework]||'var(--text2)',
                            background:`${frameworkColor[q.framework]||'var(--surface)'}22`,
                            border:`1px solid ${frameworkColor[q.framework]||'var(--border)'}44` }}>{q.framework}</span>
                        </div>
                        <div style={{ fontSize:13, fontWeight:500, marginBottom:6, lineHeight:1.5 }}>Q: {q.question}</div>
                        <div style={{ fontSize:12, color:'var(--text3)' }}>Testing: {q.angle}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Gap questions */}
                <div style={{ ...card, marginBottom:20 }}>
                  <div style={sectionTitle}>⚠️ Gap Questions — How to Handle Them</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:12 }}>
                    {(interviewData.gap_questions||[]).map((q,i) => (
                      <div key={i} className="interview-card" style={{ background:'rgba(248,113,113,.05)', border:'1px solid rgba(248,113,113,.2)', borderRadius:10, padding:14 }}>
                        <div style={{ fontSize:13, fontWeight:500, marginBottom:8, lineHeight:1.5 }}>Q: {q.question}</div>
                        <div style={{ fontSize:12, color:'#f87171', display:'flex', gap:5, lineHeight:1.5 }}>
                          <span>🛡</span><span>{q.how_to_handle}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quick wins */}
                <div style={card}>
                  <div style={sectionTitle}>⚡ Quick Wins Before The Interview</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:10 }}>
                    {(interviewData.quick_wins||[]).map((tip,i) => (
                      <div key={i} style={{ background:'rgba(52,211,153,.06)', border:'1px solid rgba(52,211,153,.18)', borderRadius:10, padding:14, fontSize:13, lineHeight:1.5 }}>
                        <span style={{ color:'var(--green)', fontWeight:700 }}>{i+1}.</span> {tip}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════ TAB: REASONING ══════ */}
        {tab==='reasoning' && (
          <div className="fade-up" style={{display:'flex',flexDirection:'column',gap:18}}>

            {/* ── Section header ── */}
            <div style={{...card, borderLeft:'3px solid var(--accent)'}}>
              <div style={sectionTitle}>🧠 Full Reasoning Trace</div>
              <p style={{fontSize:13,color:'var(--text3)',lineHeight:1.7,margin:0}}>
                Every decision this engine made — gap scoring, pathway ordering, ATS simulation,
                and job matching — is explained below in plain English. No black box, no guesswork.
                Each section shows the exact formula or logic used to arrive at the result.
              </p>
            </div>

            {/* ── 1. Pathway & Gap Analysis ── */}
            <div style={card}>
              <div style={{...sectionTitle, color:'var(--accent)'}}>
                ⚡ 1 — Skill Gap Analysis & Pathway Logic
              </div>
              {Object.entries(reasoning_trace).map(([k,v]) => (
                <div key={k} style={{marginBottom:18}}>
                  <div style={{fontFamily:'var(--fm)',fontSize:10,color:'var(--accent)',letterSpacing:.8,textTransform:'uppercase',marginBottom:8}}>
                    {k.replace(/_/g,' ')}
                  </div>
                  <div style={{fontSize:13,color:'var(--text2)',lineHeight:1.75,
                    background:'var(--bg2)',padding:'14px 18px',borderRadius:8,
                    borderLeft:'3px solid var(--accent)'}}>
                    {v}
                  </div>
                </div>
              ))}
            </div>

            {/* ── 2. ATS Score Reasoning ── */}
            {ats_score && (
              <div style={card}>
                <div style={{...sectionTitle, color:'#2dd4bf'}}>
                  🤖 2 — ATS Score Reasoning
                </div>
                <p style={{fontSize:13,color:'var(--text3)',lineHeight:1.7,marginBottom:18}}>
                  The ATS score simulates how an Applicant Tracking System would rank this resume
                  before a human ever reads it. It is computed across 5 independent dimensions,
                  each weighted by real-world ATS priorities.
                </p>

                {/* Formula */}
                <div style={{background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:10,
                  padding:'14px 18px',marginBottom:18,fontFamily:'var(--fm)',fontSize:12,lineHeight:1.9}}>
                  <div style={{color:'#2dd4bf',letterSpacing:.8,textTransform:'uppercase',fontSize:10,marginBottom:8}}>Score Formula</div>
                  <div style={{color:'var(--text2)'}}>
                    <span style={{color:'#2dd4bf'}}>total</span> = keyword_match (35) + section_presence (25) + quantification (20) + action_verbs (10) + length_density (10)
                  </div>
                  <div style={{color:'var(--text3)',fontSize:11,marginTop:6}}>
                    Grade: A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · F &lt; 40
                  </div>
                </div>

                {/* Per-dimension explanation */}
                {Object.values(ats_score.breakdown||{}).map((dim,i) => {
                  const pct = Math.round((dim.score/dim.max)*100);
                  const col = pct>=70?'#34d399':pct>=40?'#fbbf24':'#f87171';
                  const explanations = {
                    'Keyword Match':           `Matched ${ats_score.keyword_hit_rate}% of the JD's required keywords. Score = (matched_keywords / required_keywords) × 35. ${ats_score.missing_critical?.length ? `${ats_score.missing_critical.length} critical keywords are still absent from the resume.` : 'All critical keywords are present.'}`,
                    'Section Structure':       `Detected resume sections and scored their presence. Critical sections (Experience, Education, Skills) contribute 18 pts; bonus sections (Summary, Projects, Certifications, Contact) contribute 7 pts. Missing sections are flagged as structural gaps.`,
                    'Quantified Achievements': `Scanned for numeric evidence of impact — percentages, currency figures, user/team counts, and improvement verbs followed by numbers. Found ${ats_score.quantified_hits} quantified result${ats_score.quantified_hits!==1?'s':''} (max score at 5+). Quantification signals to ATS that the candidate measures their own work.`,
                    'Action Verb Usage':       `Counted strong action verbs at the start of bullet points (built, designed, led, optimised, shipped, etc.). Found ${ats_score.action_verb_hits} action verb${ats_score.action_verb_hits!==1?'s':''} (max score at 5+). Passive phrases like "was responsible for" score zero.`,
                    'Length & Density':        `Resume word count: ${ats_score.word_count} words. Optimal ATS range is 300–800 words. ${ats_score.word_count < 300 ? 'Resume is too short — ATS parsers expect more content.' : ats_score.word_count > 800 ? 'Resume may be too long — ATS systems often truncate after page 2.' : 'Word count is in the optimal range.'}`,
                  };
                  return (
                    <div key={i} style={{marginBottom:14}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6,gap:10}}>
                        <div style={{fontFamily:'var(--fm)',fontSize:10,color:col,letterSpacing:.6,textTransform:'uppercase'}}>
                          {dim.label}
                        </div>
                        <div style={{fontFamily:'var(--fm)',fontSize:11,color:col,flexShrink:0}}>
                          {dim.score} / {dim.max} ({pct}%)
                        </div>
                      </div>
                      <div style={{height:3,background:'var(--bg2)',borderRadius:2,overflow:'hidden',marginBottom:8}}>
                        <div style={{height:'100%',width:`${pct}%`,background:col,borderRadius:2}}/>
                      </div>
                      <div style={{fontSize:12,color:'var(--text2)',lineHeight:1.65,
                        background:'var(--bg2)',padding:'10px 14px',borderRadius:8,
                        borderLeft:`2px solid ${col}`}}>
                        {explanations[dim.label] || `Score: ${dim.score}/${dim.max}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── 3. Job Matching Reasoning ── */}
            {job_recommendations && (
              <div style={card}>
                <div style={{...sectionTitle, color:'#a78bfa'}}>
                  💼 3 — Job Matching Reasoning
                </div>
                <p style={{fontSize:13,color:'var(--text3)',lineHeight:1.7,marginBottom:18}}>
                  Each role is scored by matching the candidate's detected skills against a curated
                  profile of required and bonus skills. The fit percentage is computed using a
                  weighted formula that prioritises required skills over bonus skills.
                </p>

                {/* Formula */}
                <div style={{background:'var(--bg2)',border:'1px solid var(--border2)',borderRadius:10,
                  padding:'14px 18px',marginBottom:18,fontFamily:'var(--fm)',fontSize:12,lineHeight:1.9}}>
                  <div style={{color:'#a78bfa',letterSpacing:.8,textTransform:'uppercase',fontSize:10,marginBottom:8}}>Fit Formula</div>
                  <div style={{color:'var(--text2)'}}>
                    <span style={{color:'#a78bfa'}}>fit%</span> = (matched_required / total_required) × <span style={{color:'#34d399'}}>70</span>
                    &nbsp;+&nbsp; (matched_bonus / total_bonus) × <span style={{color:'#fbbf24'}}>30</span>
                  </div>
                  <div style={{color:'var(--text3)',fontSize:11,marginTop:6}}>
                    Ready ≥ 70% · Almost Ready 55–69% · Needs Work &lt; 55%
                  </div>
                </div>

                {/* Per-role reasoning */}
                {(job_recommendations.recommendations||[]).map((job,i) => {
                  const col = job.ready?'#34d399':job.almost_ready?'#fbbf24':'var(--text3)';
                  const status = job.ready?'✅ Ready':'🟡 Almost Ready';
                  return (
                    <div key={i} style={{marginBottom:14,padding:'14px 16px',
                      background:'var(--bg2)',borderRadius:10,
                      borderLeft:`2px solid ${col}`}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6,gap:10}}>
                        <div style={{fontWeight:600,fontSize:13}}>{job.role}</div>
                        <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                          {(job.ready||job.almost_ready) && (
                            <span style={{fontFamily:'var(--fm)',fontSize:10,color:col}}>{status}</span>
                          )}
                          <span style={{fontFamily:'var(--fm)',fontSize:13,fontWeight:700,color:col}}>{job.fit_percent}%</span>
                        </div>
                      </div>
                      <div style={{fontSize:12,color:'var(--text2)',lineHeight:1.65}}>
                        Matched <strong style={{color:'#34d399'}}>{job.matched_skills.length}</strong> skill{job.matched_skills.length!==1?'s':''} ({job.matched_skills.slice(0,3).join(', ')}{job.matched_skills.length>3?'…':''}).
                        {job.missing_required.length>0 ? (
                          <span> Still missing <strong style={{color:'#f87171'}}>{job.missing_required.length}</strong> required skill{job.missing_required.length!==1?'s':''}: {job.missing_required.slice(0,3).join(', ')}{job.missing_required.length>3?'…':''}.</span>
                        ) : (
                          <span style={{color:'#34d399'}}> All required skills are present.</span>
                        )}
                        {job.strong_in.length>0 && (
                          <span> Advanced/expert in: {job.strong_in.slice(0,3).join(', ')}.</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}

        {/* ════ TAB: ATS SCORE ════ */}
        {tab==='ats' && ats_score && (
          <div className="fade-up">
            {/* Score hero */}
            <div style={{ ...card, marginBottom:18, display:'flex', gap:28, alignItems:'center', flexWrap:'wrap' }}>
              <div style={{ textAlign:'center', minWidth:120 }}>
                <div style={{ position:'relative', width:110, height:110, margin:'0 auto' }}>
                  <svg width="110" height="110">
                    <circle cx="55" cy="55" r="46" fill="none" stroke="var(--border2)" strokeWidth="7"/>
                    <circle cx="55" cy="55" r="46" fill="none"
                      stroke={ats_score.total_score>=70?'#34d399':ats_score.total_score>=50?'#fbbf24':'#f87171'}
                      strokeWidth="7" strokeLinecap="round"
                      strokeDasharray={`${2*Math.PI*46}`}
                      strokeDashoffset={`${2*Math.PI*46*(1-ats_score.total_score/100)}`}
                      transform="rotate(-90 55 55)"
                    />
                    <text x="55" y="50" textAnchor="middle" style={{fontFamily:'var(--fd)',fontSize:26,fontWeight:800,fill:ats_score.total_score>=70?'#34d399':ats_score.total_score>=50?'#fbbf24':'#f87171'}}>{ats_score.total_score}</text>
                    <text x="55" y="66" textAnchor="middle" style={{fontFamily:'var(--fm)',fontSize:10,fill:'var(--text3)'}}>/ 100</text>
                  </svg>
                </div>
                <div style={{fontFamily:'var(--fd)',fontSize:28,fontWeight:800,color:ats_score.grade==='A'?'#34d399':ats_score.grade==='B'?'#a78bfa':ats_score.grade==='C'?'#fbbf24':'#f87171',marginTop:4}}>Grade {ats_score.grade}</div>
                <div style={{fontFamily:'var(--fm)',fontSize:10,color:'var(--text3)',letterSpacing:.8,textTransform:'uppercase',marginTop:4}}>ATS Pass Probability</div>
              </div>
              <div style={{flex:1}}>
                <div style={{...sectionTitle,marginBottom:14}}>📊 Score Breakdown</div>
                {Object.values(ats_score.breakdown||{}).map((dim,i) => (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                    <div style={{width:160,fontSize:12,color:'var(--text2)'}}>{dim.label}</div>
                    <div style={{flex:1,height:6,background:'var(--bg2)',borderRadius:3,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${(dim.score/dim.max)*100}%`,
                        background:dim.score/dim.max>=.7?'#34d399':dim.score/dim.max>=.4?'#fbbf24':'#f87171',
                        borderRadius:3,transition:'width .5s ease'}}/>
                    </div>
                    <div style={{fontFamily:'var(--fm)',fontSize:11,color:'var(--text2)',width:50,textAlign:'right'}}>{dim.score}/{dim.max}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18,marginBottom:18}}>
              {/* Keywords */}
              <div style={card}>
                <div style={sectionTitle}>🔑 Keyword Match — {ats_score.keyword_hit_rate}%</div>
                {(ats_score.missing_critical||[]).length>0 && (
                  <div style={{marginBottom:14}}>
                    <div style={{fontFamily:'var(--fm)',fontSize:10,color:'#f87171',letterSpacing:.6,textTransform:'uppercase',marginBottom:7}}>❌ Critical Missing</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                      {ats_score.missing_critical.map((k,i)=>(
                        <span key={i} style={{background:'rgba(248,113,113,.08)',border:'1px solid rgba(248,113,113,.2)',
                          color:'#f87171',borderRadius:6,padding:'3px 10px',fontSize:11,fontFamily:'var(--fm)'}}>{k}</span>
                      ))}
                    </div>
                  </div>
                )}
                {(ats_score.matched_keywords||[]).length>0 && (
                  <div>
                    <div style={{fontFamily:'var(--fm)',fontSize:10,color:'#34d399',letterSpacing:.6,textTransform:'uppercase',marginBottom:7}}>✅ Matched</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                      {ats_score.matched_keywords.slice(0,10).map((k,i)=>(
                        <span key={i} style={{background:'rgba(52,211,153,.07)',border:'1px solid rgba(52,211,153,.18)',
                          color:'#34d399',borderRadius:6,padding:'3px 10px',fontSize:11,fontFamily:'var(--fm)'}}>{k}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Sections detected */}
              <div style={card}>
                <div style={sectionTitle}>🗂 Resume Sections Detected</div>
                {Object.entries(ats_score.sections_detected||{}).map(([sec,found],i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:10,marginBottom:9,paddingBottom:9,borderBottom:'1px solid var(--border)'}}>
                    <span style={{fontSize:15}}>{found?'✅':'❌'}</span>
                    <span style={{fontSize:13,fontWeight:500,textTransform:'capitalize',flex:1}}>{sec}</span>
                    <span style={{fontFamily:'var(--fm)',fontSize:10,color:found?'#34d399':'#f87171'}}>{found?'Found':'Missing'}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ATS Tips */}
            {(ats_score.tips||[]).length>0 && (
              <div style={card}>
                <div style={sectionTitle}>💡 How to Improve Your ATS Score</div>
                {ats_score.tips.map((tip,i)=>(
                  <div key={i} style={{display:'flex',gap:12,marginBottom:12,padding:'12px 14px',
                    background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:10}}>
                    <span style={{color:'var(--accent)',fontWeight:700,flexShrink:0}}>{i+1}.</span>
                    <span style={{fontSize:13,color:'var(--text2)',lineHeight:1.6}}>{tip}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════ TAB: RESUME TIPS ════ */}
        {tab==='resume-tips' && resume_suggestions && (
          <div className="fade-up">
            <div style={{...card,marginBottom:18,display:'flex',gap:20,alignItems:'center',flexWrap:'wrap'}}>
              <div>
                <div style={{fontFamily:'var(--fd)',fontSize:26,fontWeight:800,letterSpacing:-1}}>{resume_suggestions.total_suggestions}</div>
                <div style={{fontFamily:'var(--fm)',fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:.8}}>Total Suggestions</div>
              </div>
              <div style={{width:1,height:40,background:'var(--border)'}}/>
              <div>
                <div style={{fontFamily:'var(--fd)',fontSize:26,fontWeight:800,letterSpacing:-1,color:'#f87171'}}>{resume_suggestions.high_priority}</div>
                <div style={{fontFamily:'var(--fm)',fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:.8}}>High Priority</div>
              </div>
              <div style={{flex:1,fontSize:13,color:'var(--text2)',lineHeight:1.65,maxWidth:480}}>
                These suggestions are based on your resume vs the JD. Address high-priority items first — they have the biggest impact on recruiter and ATS screening.
              </div>
            </div>

            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {(resume_suggestions.suggestions||[]).map((s,i)=>(
                <div key={i} style={{
                  background:'var(--surface)',border:`1px solid ${s.priority==='high'?'rgba(248,113,113,.25)':s.priority==='medium'?'rgba(251,191,36,.2)':'var(--border)'}`,
                  borderLeft:`3px solid ${s.priority==='high'?'#f87171':s.priority==='medium'?'#fbbf24':'#34d399'}`,
                  borderRadius:12,padding:18,
                }}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8,gap:12}}>
                    <div style={{display:'flex',gap:10,alignItems:'center'}}>
                      <span style={{fontSize:20}}>{s.icon}</span>
                      <div>
                        <div style={{fontWeight:600,fontSize:14,letterSpacing:'-.2px'}}>{s.title}</div>
                        <div style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--text3)',textTransform:'uppercase',letterSpacing:.8,marginTop:2}}>{s.category}</div>
                      </div>
                    </div>
                    <span style={{
                      fontFamily:'var(--fm)',fontSize:9,padding:'3px 10px',borderRadius:100,letterSpacing:.6,flexShrink:0,
                      color:s.priority==='high'?'#f87171':s.priority==='medium'?'#fbbf24':'#34d399',
                      background:s.priority==='high'?'rgba(248,113,113,.08)':s.priority==='medium'?'rgba(251,191,36,.08)':'rgba(52,211,153,.08)',
                      border:`1px solid ${s.priority==='high'?'rgba(248,113,113,.2)':s.priority==='medium'?'rgba(251,191,36,.2)':'rgba(52,211,153,.2)'}`,
                    }}>{s.priority.toUpperCase()}</span>
                  </div>
                  <p style={{fontSize:13,color:'var(--text2)',lineHeight:1.65,marginBottom:10}}>{s.detail}</p>
                  <div style={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 14px',
                    fontSize:13,color:'var(--accent)',lineHeight:1.6}}>
                    <span style={{fontWeight:600}}>Action: </span>{s.action}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════ TAB: WEEKLY ROADMAP ════ */}
        {tab==='roadmap' && weekly_roadmap && (
          <div className="fade-up">
            {/* Summary */}
            <div style={{...card,marginBottom:18}}>
              <div style={sectionTitle}>📆 Your Week-by-Week Learning Calendar</div>
              <div style={{display:'flex',gap:24,flexWrap:'wrap',marginBottom:8}}>
                {[
                  {v:weekly_roadmap.total_weeks,l:'Total Weeks'},
                  {v:`${weekly_roadmap.total_hours}h`,l:'Total Hours'},
                  {v:`${weekly_roadmap.daily_target_hours}h/day`,l:'Daily Target'},
                  {v:(weekly_roadmap.milestones||[]).length,l:'Milestones'},
                ].map((s,i)=>(
                  <div key={i} style={{textAlign:'center'}}>
                    <div style={{fontFamily:'var(--fd)',fontSize:22,fontWeight:800,letterSpacing:-1}}>{s.v}</div>
                    <div style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--text3)',textTransform:'uppercase',letterSpacing:.8,marginTop:2}}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Week cards */}
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {(weekly_roadmap.weeks||[]).map((week,i)=>{
                const COLS=['#f59e0b','#2dd4bf','#f87171','#a78bfa'];
                const col=COLS[(week.phase-1)%4];
                const isMilestone=(weekly_roadmap.milestones||[]).some(m=>m.week===week.week);
                return (
                  <div key={i}>
                    <div style={{
                      background:'var(--surface)',border:`1px solid ${col}22`,
                      borderLeft:`3px solid ${col}`,borderRadius:12,padding:18,
                    }}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12,gap:12,flexWrap:'wrap'}}>
                        <div style={{display:'flex',alignItems:'center',gap:12}}>
                          <div style={{width:36,height:36,borderRadius:8,background:`${col}18`,border:`1.5px solid ${col}`,
                            display:'flex',alignItems:'center',justifyContent:'center',
                            fontFamily:'var(--fd)',fontSize:14,fontWeight:800,color:col,flexShrink:0}}>
                            W{week.week}
                          </div>
                          <div>
                            <div style={{fontWeight:600,fontSize:14}}>
                              {week.focus.length>0 ? week.focus.join(' · ') : week.phase_name}
                            </div>
                            <div style={{fontFamily:'var(--fm)',fontSize:10,color:'var(--text3)',marginTop:2}}>
                              Phase {week.phase} · {week.estimated_hours}h · {week.daily_hours}h/day
                            </div>
                          </div>
                        </div>
                        <span style={{fontFamily:'var(--fm)',fontSize:9,padding:'3px 10px',borderRadius:100,
                          color:col,background:`${col}12`,border:`1px solid ${col}30`}}>
                          {week.phase_name}
                        </span>
                      </div>

                      {/* Modules */}
                      {week.modules.length>0 && (
                        <div style={{display:'flex',flexWrap:'wrap',gap:7,marginBottom:12}}>
                          {week.modules.map((mod,j)=>(
                            <a key={j} href={mod.url||'#'} target="_blank" rel="noreferrer" style={{
                              background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:8,
                              padding:'7px 12px',fontSize:12,display:'flex',alignItems:'center',gap:6,
                            }}>
                              <span style={{color:mod.free?'#34d399':'#fbbf24'}}>{mod.free?'🆓':'💳'}</span>
                              <span style={{fontWeight:500}}>{mod.skill}</span>
                              <span style={{color:'var(--text3)',fontFamily:'var(--fm)',fontSize:10}}>{mod.hours}h</span>
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Tasks */}
                      <div>
                        {week.tasks.map((task,j)=>(
                          <div key={j} style={{display:'flex',gap:7,fontSize:12,color:'var(--text2)',marginBottom:4,lineHeight:1.5}}>
                            <span style={{color:col,flexShrink:0}}>›</span>{task}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Milestone banner */}
                    {isMilestone && (()=>{
                      const m=(weekly_roadmap.milestones||[]).find(x=>x.week===week.week);
                      return m ? (
                        <div style={{background:'rgba(245,158,11,.06)',border:'1px solid rgba(245,158,11,.2)',
                          borderRadius:10,padding:'12px 18px',marginTop:8,
                          display:'flex',gap:10,alignItems:'flex-start'}}>
                          <span style={{fontSize:18,flexShrink:0}}>🏁</span>
                          <div>
                            <div style={{fontWeight:600,fontSize:13,color:'var(--accent)'}}>{m.title}</div>
                            <div style={{fontSize:12,color:'var(--text3)',marginTop:3,lineHeight:1.5}}>{m.checkpoint}</div>
                          </div>
                        </div>
                      ) : null;
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ════ TAB: JOB RECOMMENDATIONS ════ */}
        {tab==='jobs' && job_recommendations && (
          <div className="fade-up">
            {/* Summary */}
            <div style={{...card,marginBottom:18,display:'flex',gap:24,alignItems:'center',flexWrap:'wrap'}}>
              <div style={{textAlign:'center'}}>
                <div style={{fontFamily:'var(--fd)',fontSize:28,fontWeight:800,color:'#34d399'}}>{job_recommendations.ready_now}</div>
                <div style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--text3)',textTransform:'uppercase',letterSpacing:.8,marginTop:2}}>Ready Now</div>
              </div>
              <div style={{width:1,height:40,background:'var(--border)'}}/>
              <div style={{textAlign:'center'}}>
                <div style={{fontFamily:'var(--fd)',fontSize:28,fontWeight:800,color:'#fbbf24'}}>{job_recommendations.almost_ready}</div>
                <div style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--text3)',textTransform:'uppercase',letterSpacing:.8,marginTop:2}}>Almost Ready</div>
              </div>
              <div style={{width:1,height:40,background:'var(--border)'}}/>
              <div style={{flex:1,fontSize:13,color:'var(--text2)',lineHeight:1.65,maxWidth:460}}>
                Matched your skills against {job_recommendations.total_roles_analysed} role profiles. Roles where you meet 70%+ of requirements are marked as ready.
              </div>
            </div>

            {/* Role cards */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(290px,1fr))',gap:14}}>
              {(job_recommendations.recommendations||[]).map((job,i)=>(
                <div key={i} style={{
                  background:'var(--surface)',borderRadius:14,padding:18,
                  border:`1.5px solid ${job.ready?'rgba(52,211,153,.25)':job.almost_ready?'rgba(251,191,36,.2)':'var(--border)'}`,
                  position:'relative',overflow:'hidden',
                }}>
                  {/* Fit bar background */}
                  <div style={{position:'absolute',inset:0,background:`linear-gradient(90deg, ${
                    job.ready?'rgba(52,211,153,.04)':job.almost_ready?'rgba(251,191,36,.03)':'transparent'
                  } ${job.fit_percent}%, transparent ${job.fit_percent}%)`,pointerEvents:'none'}}/>

                  {/* Header */}
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8,gap:8}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:14,letterSpacing:'-.2px'}}>{job.role}</div>
                      <div style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--text3)',textTransform:'uppercase',letterSpacing:.8,marginTop:2}}>{job.category}</div>
                    </div>
                    <div style={{textAlign:'center',flexShrink:0}}>
                      <div style={{fontFamily:'var(--fd)',fontSize:22,fontWeight:800,letterSpacing:-1,
                        color:job.ready?'#34d399':job.almost_ready?'#fbbf24':'var(--text2)'}}>{job.fit_percent}%</div>
                      <div style={{fontFamily:'var(--fm)',fontSize:8,color:'var(--text3)',textTransform:'uppercase',letterSpacing:.5}}>Fit</div>
                    </div>
                  </div>

                  {/* Fit bar */}
                  <div style={{height:4,background:'var(--bg2)',borderRadius:2,overflow:'hidden',marginBottom:10}}>
                    <div style={{height:'100%',borderRadius:2,transition:'width .5s ease',
                      width:`${job.fit_percent}%`,
                      background:job.ready?'#34d399':job.almost_ready?'#fbbf24':'#f87171'}}/>
                  </div>

                  <p style={{fontSize:12,color:'var(--text3)',marginBottom:10,lineHeight:1.55}}>{job.description}</p>

                  {/* Salary */}
                  <div style={{fontFamily:'var(--fm)',fontSize:11,color:'var(--accent)',marginBottom:10}}>
                    💰 {job.salary_range}
                  </div>

                  {/* Status */}
                  {job.ready ? (
                    <div style={{background:'rgba(52,211,153,.08)',border:'1px solid rgba(52,211,153,.2)',
                      borderRadius:8,padding:'6px 10px',fontSize:12,color:'#34d399',marginBottom:10}}>
                      ✅ You're qualified — apply now
                    </div>
                  ) : job.almost_ready ? (
                    <div style={{background:'rgba(251,191,36,.07)',border:'1px solid rgba(251,191,36,.2)',
                      borderRadius:8,padding:'6px 10px',fontSize:12,color:'#fbbf24',marginBottom:10}}>
                      🟡 Close — {job.skills_to_learn.slice(0,2).join(', ')} would close the gap
                    </div>
                  ) : (
                    <div style={{background:'var(--bg2)',border:'1px solid var(--border)',
                      borderRadius:8,padding:'6px 10px',fontSize:12,color:'var(--text3)',marginBottom:10}}>
                      📚 Needs work — focus on your pathway first
                    </div>
                  )}

                  {/* Matched */}
                  {job.matched_skills.length>0 && (
                    <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:12}}>
                      {job.matched_skills.slice(0,4).map((sk,j)=>(
                        <span key={j} style={{fontFamily:'var(--fm)',fontSize:9,padding:'2px 7px',borderRadius:4,
                          background:'rgba(52,211,153,.07)',color:'#34d399',border:'1px solid rgba(52,211,153,.15)'}}>{sk}</span>
                      ))}
                      {job.matched_skills.length>4 && (
                        <span style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--text3)'}}>+{job.matched_skills.length-4} more</span>
                      )}
                    </div>
                  )}

                  {/* Apply buttons */}
                  {(job.apply_links||[]).length>0 && (
                    <div style={{borderTop:'1px solid var(--border)',paddingTop:12,marginTop:4}}>
                      <div style={{fontFamily:'var(--fm)',fontSize:9,color:'var(--text3)',letterSpacing:.8,textTransform:'uppercase',marginBottom:8}}>
                        Apply On
                      </div>
                      <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>
                        {job.apply_links.map((link,j)=>{
                          const platformStyle = {
                            LinkedIn: {bg:'#0A66C2', icon:'in'},
                            Naukri:   {bg:'#FF7555', icon:'N'},
                            Indeed:   {bg:'#003A9B', icon:'id'},
                          }[link.platform] || {bg:'var(--accent)',icon:'↗'};
                          return (
                            <a key={j} href={link.url} target="_blank" rel="noreferrer"
                              style={{
                                display:'inline-flex', alignItems:'center', gap:6,
                                padding:'6px 12px', borderRadius:8, fontSize:12, fontWeight:600,
                                background: platformStyle.bg, color:'#fff',
                                textDecoration:'none', transition:'opacity .15s',
                              }}
                              onMouseEnter={e=>e.currentTarget.style.opacity='.82'}
                              onMouseLeave={e=>e.currentTarget.style.opacity='1'}
                            >
                              <span style={{fontFamily:'var(--fm)',fontSize:10,fontWeight:800,
                                background:'rgba(255,255,255,.2)',borderRadius:4,padding:'1px 5px'}}>
                                {platformStyle.icon}
                              </span>
                              {link.platform}
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}


      </div>
    </div>
  );
}
