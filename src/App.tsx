import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import DataSources from "./pages/DataSources";
import DataProducts from "./pages/DataProducts";
import Attribution from "./pages/Attribution";
import AdminImports from "./pages/AdminImports";
import AdminAttribution from "./pages/AdminAttribution";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route 
              path="/dashboard" 
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/admin" 
              element={
                <AdminRoute>
                  <Admin />
                </AdminRoute>
              } 
            />
            <Route 
              path="/admin/imports" 
              element={
                <AdminRoute>
                  <AdminImports />
                </AdminRoute>
              } 
            />
            <Route 
              path="/admin/attribution" 
              element={
                <AdminRoute>
                  <AdminAttribution />
                </AdminRoute>
              }
            />
            <Route
              path="/data-sources" 
              element={
                <ProtectedRoute>
                  <DataSources />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/data-products" 
              element={
                <ProtectedRoute>
                  <DataProducts />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/attribution" 
              element={
                <ProtectedRoute>
                  <Attribution />
                </ProtectedRoute>
              } 
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
