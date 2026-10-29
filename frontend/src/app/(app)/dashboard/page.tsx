"use client";

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getResumes, deleteResume, extractResume } from '@/lib/api/resume.api';
import ResumeSkills from '@/components/ResumeSkills';
import ResumeSections from '@/components/ResumeSections';
import ResumeAnalysis from '@/components/ResumeAnalysis';
import ResumeJobMatch from '@/components/ResumeJobMatch';
import DashboardAnalytics from '@/components/DashboardAnalytics';
import RemindersPanel from '@/components/RemindersPanel';
import FileIcon from '@/components/FileIcon';
import DashboardWorkspace from '@/components/DashboardWorkspace';
import type { ResumeSummary } from '@/lib/api/resume.api';
import { getJobDescriptions, type JobDescriptionSummary } from '@/lib/api/jobDescription.api';

export default function Dashboard() {
  const { user, isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const [resumes, setResumes] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [jobDescriptions, setJobDescriptions] = useState<JobDescriptionSummary[]>([]);
  // Bumped when a match is saved, so the overview reflects it.
  const [analyticsKey, setAnalyticsKey] = useState(0);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    }
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchResumesData();
      const interval = setInterval(fetchResumesData, 5000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  // Loaded once for the matching selector; the resume list is what is polled.
  useEffect(() => {
    if (!isAuthenticated) return;
    getJobDescriptions()
      .then((data) => setJobDescriptions(data.data.jobDescriptions))
      .catch((err: unknown) => console.error('Failed to fetch job descriptions:', err instanceof Error ? err.message : err));
  }, [isAuthenticated]);

  const fetchResumesData = async () => {
    try {
      const data = await getResumes();
      if (data.success) {
        setResumes(data.data.resumes);
      }
    } catch (err: any) {
      console.error('Failed to fetch resumes:', err.message);
    } finally {
      setFetching(false);
    }
  };

  const handleDelete = async (id: string) => {
    const name = resumes.find(r => r.id === id)?.originalFilename ?? 'this resume';
    if (!confirm(`Delete "${name}"?\n\nIts extracted text and skills, and any saved match results that used it, are also deleted.\n\nThis action cannot be undone.`)) return;
    try {
      const data = await deleteResume(id);
      if (data.success) {
        alert('Resume deleted successfully.');
        setResumes(resumes.filter(r => r.id !== id));
      } else {
        alert(data.message || 'Failed to delete resume');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete resume');
    }
  };

  const retryExtraction = async (id: string) => {
    try {
      setResumes(resumes.map(r => r.id === id ? { ...r, extractionStatus: 'processing' } : r));
      
      const data = await extractResume(id);
      if (!data.success) {
        alert(data.message || 'Extraction failed');
      }
      fetchResumesData();
    } catch (err: any) {
      alert(err.message || 'Failed to trigger extraction');
      fetchResumesData();
    }
  };

  const renderStatus = (resume: any) => {
    switch (resume.extractionStatus) {
      case 'completed':
        return <p className="text-green-700 font-medium">Text extraction: ✓ Completed</p>;
      case 'processing':
      case 'pending':
        return <p className="text-blue-600 font-medium">Extracting text...</p>;
      case 'no_text':
        return (
          <div className="space-y-2">
            <p className="text-red-600 font-medium text-sm">
              No readable text was found in this PDF.<br/>
              OCR is not currently supported.
            </p>
            <button onClick={() => retryExtraction(resume.id)} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded transition">
              Retry Extraction
            </button>
          </div>
        );
      case 'failed':
      default:
        return (
          <div className="space-y-2">
            <p className="text-red-600 font-medium text-sm">Unable to extract text from this resume.</p>
            <button onClick={() => retryExtraction(resume.id)} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded transition">
              Retry Extraction
            </button>
          </div>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-64px)]">
        <p className="text-xl text-gray-600">Loading your resumes...</p>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="page-container p-4 md:p-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Welcome, {user?.name}</h1>
          <p className="text-gray-600">Your resumes, matches and next steps.</p>
        </div>
        <Link href="/resume/upload" className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium text-center whitespace-nowrap">
          Upload New Resume
        </Link>
      </div>
      
      <DashboardWorkspace resumes={resumes as ResumeSummary[]} jobs={jobDescriptions} loading={fetching} />
      <RemindersPanel />
      <DashboardAnalytics reloadKey={analyticsKey} />

      <div id="my-resumes" className="rounded-xl border border-line bg-white p-5 md:p-6 scroll-mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-6">
          <h2 className="text-lg font-semibold">My Resumes</h2>
          <Link href="/dashboard/resumes" className="text-blue-600 hover:text-blue-800 font-medium">
            Manage resumes
          </Link>
        </div>
        
        {fetching && resumes.length === 0 ? (
          <div className="animate-pulse flex space-x-4">
            <div className="flex-1 space-y-4 py-1">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-5/6"></div>
              </div>
            </div>
          </div>
        ) : resumes.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 text-lg mb-4">No resumes uploaded yet.</p>
            <p className="text-gray-500 mb-8">Upload your first resume to start analyzing your profile.</p>
            <Link href="/resume/upload" className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition font-medium">
              Upload Resume
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {resumes.map(resume => (
              <div key={resume.id} className="border border-gray-200 p-6 rounded-xl flex flex-col h-full bg-gray-50 hover:bg-white transition duration-200">
                <div className="flex items-start mb-4">
                  <FileIcon className="h-10 w-8 mr-3" />
                  <div className="overflow-hidden">
                    <p className="font-bold text-gray-900 truncate" title={resume.originalFilename}>
                      {resume.originalFilename}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      Uploaded: {new Date(resume.createdAt).toLocaleDateString()}
                    </p>
                    <p className="text-sm text-gray-500">
                      Size: {(resume.fileSize / 1024).toFixed(0)} KB
                    </p>
                  </div>
                </div>
                
                <div className="mb-6 flex-grow space-y-4">
                  {renderStatus(resume)}
                  {resume.extractionStatus === 'completed' && (
                    <div className="border-t pt-4">
                      <p className="font-semibold text-gray-900 mb-2">Skills</p>
                      <ResumeSkills resumeId={resume.id} skillsExtractedAt={resume.skillsExtractedAt ?? null} />
                    </div>
                  )}
                  {resume.extractionStatus === 'completed' && (
                    <div className="border-t pt-4">
                      <p className="font-semibold text-gray-900 mb-2">Resume Sections</p>
                      <ResumeSections resumeId={resume.id} />
                    </div>
                  )}
                  {resume.extractionStatus === 'completed' && (
                    <div className="border-t pt-4">
                      <p className="font-semibold text-gray-900 mb-2">Resume Analysis</p>
                      <ResumeAnalysis resumeId={resume.id} />
                    </div>
                  )}
                  {resume.extractionStatus === 'completed' && (
                    <div className="border-t pt-4">
                      <p className="font-semibold text-gray-900 mb-2">Match Resume With Job</p>
                      <ResumeJobMatch
                        resumeId={resume.id}
                        jobDescriptions={jobDescriptions}
                        onMatchSaved={() => setAnalyticsKey((key) => key + 1)}
                      />
                    </div>
                  )}
                </div>
                
                <div className="flex items-center justify-between border-t pt-4 mt-auto">
                  <Link
                    href={`/dashboard/resumes/${resume.id}`}
                    className="text-blue-600 font-semibold hover:text-blue-800 transition"
                  >
                    View Details
                  </Link>
                  <button 
                    onClick={() => handleDelete(resume.id)} 
                    className="text-red-700 hover:text-red-700 font-medium transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
