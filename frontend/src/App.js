import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import UploadPage from './pages/UploadPage';
import ResultsPage from './pages/ResultsPage';

export default function App() {
  const [result, setResult] = useState(null);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UploadPage onResult={setResult} />} />
        <Route
          path="/results"
          element={result
            ? <ResultsPage data={result} onReset={() => setResult(null)} />
            : <Navigate to="/" replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}
