import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import './UploadPage.css';

function DropZone({ label, icon, file, onFile }) {
  const onDrop = useCallback(acc => { if (acc[0]) onFile(acc[0]); }, [onFile]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt'],
    },
    multiple: false,
  });

  const cls = ['dz', isDragActive ? 'dz-over' : '', file ? 'dz-done' : ''].join(' ').trim();

  return (
    <div {...getRootProps()} className={cls}>
      <input {...getInputProps()} />
      <div className={`dz-icon${file ? ' done' : ''}`}>{file ? '✓' : icon}</div>
      <div>
        <div className="dz-label">{label}</div>
        <div className="dz-sub">{file ? 'Click to replace' : 'Drop or click to browse'}</div>
      </div>
      {file
        ? <div className="dz-fname">{file.name}</div>
        : <div className="dz-types">PDF · DOCX · TXT</div>
      }
    </div>
  );
}

export default function UploadPage({ onResult }) {
  const [resume, setResume] = useState(null);
  const [jd, setJd] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit() {
    if (!resume || !jd) return;
    setLoading(true);
    setError('');
    const form = new FormData();
    form.append('resume', resume);
    form.append('job_description', jd);
    try {
      const base = process.env.REACT_APP_API_URL || 'http://localhost:8000';
      const { data } = await axios.post(`${base}/analyze`, form, { timeout: 60000 });
      onResult(data);
      navigate('/results');
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Request failed. Please retry.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="hdr">
        <div className="hdr-dot" />
        <div className="hdr-logo">Skill<span>Path</span></div>
      </header>

      <main className="main">
        <div className="hero fade-up">
          <div className="hero-tag">⚡ Adaptive Onboarding Engine</div>
          <h1 className="hero-h1">Your gap.<br /><em>Your roadmap.</em></h1>
          <p className="hero-sub">
            Upload a resume and job description. We extract your skills, find the gaps,
            and generate a personalized training pathway — instantly, no AI black-box.
          </p>
        </div>

        <div className="upload-grid fade-up-1">
          <DropZone label="Your Resume"      icon="📄" file={resume} onFile={setResume} />
          <DropZone label="Job Description"  icon="🎯" file={jd}     onFile={setJd}     />
        </div>

        <button className="cta fade-up-2" onClick={handleSubmit} disabled={!resume || !jd || loading}>
          {loading ? <><span className="spinner" /> Analyzing…</> : '⚡ Generate My Pathway'}
        </button>

        {error && <div className="err">⚠ {error}</div>}

        <div className="steps fade-up-3">
          {['Upload docs', 'NLP extraction', 'Gap scoring', 'Pathway generated'].map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && <div className="step-dash" />}
              <div className="step-item"><div className="step-n">{i + 1}</div>{s}</div>
            </React.Fragment>
          ))}
        </div>
      </main>
    </div>
  );
}
