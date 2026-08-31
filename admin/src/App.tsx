import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Reports } from './pages/Reports';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { auth } from './lib/auth';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={auth.isAuthenticated() ? <Navigate to="/" replace /> : <Login />}
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Reports />} />
          <Route path="audit-logs" element={<div style={{ padding: '32px' }}>审计日志功能开发中...</div>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
