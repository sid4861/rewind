import { useCallback, useRef, useState } from 'react';
import type { ArchiveProblem } from '@rewind/session-schema/validation';

export function Dropzone({
  onFile,
  loading,
  problems,
}: {
  onFile: (file: File) => void;
  loading: boolean;
  problems: ArchiveProblem[];
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div className="empty">
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
      >
        <div className="dropzone-mark">⏮</div>
        <h1 className="dropzone-title">Open a session archive</h1>
        <p className="dropzone-sub">
          {loading ? 'Reading archive…' : 'Drop a .zip here, or click to choose one'}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {problems.length > 0 && (
        <div className="problems">
          <div className="problems-title">This archive could not be opened</div>
          {problems.map((problem, i) => (
            <div className="problem" key={`${problem.kind}-${i}`}>
              <span className={`problem-kind ${problem.kind}`}>{problem.kind}</span>
              <div>
                <div className="problem-message">{problem.message}</div>
                {/*
                  Naming the offending field is the difference between a
                  developer fixing their archive and filing a bug against the
                  player. PLAN.md 6.2 asks for a clear error, not a stack trace.
                */}
                {'issues' in problem && problem.issues.length > 0 && (
                  <ul className="problem-issues">
                    {problem.issues.slice(0, 6).map((issue) => (
                      <li key={issue} className="mono">
                        {issue}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="empty-foot">
        Everything happens locally. Nothing in the archive is uploaded anywhere.
      </p>
    </div>
  );
}
