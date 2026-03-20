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
  { id:'pathway',   label:'🗺 Pathway'   },
  { id:'gaps',      label:'⚡ Gaps'      },
  { id:'skills',    label:'📊 Skills'    },
  { id:'timeline',  label:'📅 Timeline'  },
  { id:'interview', label:'🎯 Interview' },
  { id:'reasoning', label:'🧠 Reasoning' },
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
          <div className="fade-up" style={card}>
            <div style={sectionTitle}>🧠 Reasoning Trace</div>
            <p style={{ fontSize:13, color:'var(--text3)', marginBottom:20, lineHeight:1.6 }}>
              Every decision made by the pathway engine is explained below. No black-box.
            </p>
            {Object.entries(reasoning_trace).map(([k,v]) => (
              <div key={k} style={{ marginBottom:20 }}>
                <div style={{ fontFamily:'var(--fm)', fontSize:10, color:'var(--accent)', letterSpacing:.8, textTransform:'uppercase', marginBottom:8 }}>
                  {k.replace(/_/g,' ')}
                </div>
                <div style={{ fontSize:14, color:'var(--text2)', lineHeight:1.7,
                  background:'var(--bg2)', padding:'14px 18px', borderRadius:8,
                  borderLeft:'3px solid var(--accent)' }}>
                  {v}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}