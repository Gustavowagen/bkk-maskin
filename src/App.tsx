import { useState, useMemo, useEffect } from 'react'
import * as XLSX from 'xlsx'
import './App.css'
import FileUpload from './components/FileUpload'
import NicknameInput from './components/NicknameInput'
import ParticlesBackground from './components/ParticlesBackground'
import { readExcelFile, readNameFile, filterWorkbookByNicknames, downloadExcelFile, extractPlayerStacks, syncPlayerStacks } from './utils/excelUtils'
import type { NicknameWithLine } from './types'


function App() {
  const [file, setFile] = useState<File | null>(null)
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [nameMapping, setNameMapping] = useState<Map<string, string>>(new Map())
  const [filteredWorkbook, setFilteredWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isFiltered, setIsFiltered] = useState(false)
  const [nicknames, setNicknames] = useState<NicknameWithLine[]>([])

  // Memoize ParticlesBackground to prevent re-renders
  const particles = useMemo(() => <ParticlesBackground />, []);

  // Auto-load default name file on component mount
  useEffect(() => {
    const loadDefaultNameFile = async () => {
      try {
        const response = await fetch('/Knekt overview.xlsx');
        if (!response.ok) {
          throw new Error('Failed to fetch default name file');
        }
        const blob = await response.blob();
        const file = new File([blob], 'Knekt overview.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        
        const mapping = await readNameFile(file);
        setNameMapping(mapping);
        console.log('Default name file loaded successfully');
      } catch (error) {
        console.error('Error loading default name file:', error);
        alert('Failed to load default name file. Please refresh the page.');
      }
    };

    loadDefaultNameFile();
  }, []);

  const handleFileUpload = async (uploadedFile: File) => {
    setFile(uploadedFile)
    setIsFiltered(false)
    setFilteredWorkbook(null)
    
    try {
      const wb = await readExcelFile(uploadedFile)
      setWorkbook(wb)

      // Silent, best-effort sync — must never block the upload flow above.
      try {
        const players = extractPlayerStacks(wb)
        syncPlayerStacks(players)
      } catch (error) {
        console.error('Error extracting player stacks:', error)
      }
    } catch (error) {
      console.error('Error reading file:', error)
      alert('Error reading Excel file. Please make sure it is a valid Excel file.')
    }
  }

  const handleFilter = () => {
    if (!workbook) return
    
    setIsProcessing(true)
    
    try {
      // Apply filtering logic with name mapping
      const filtered = filterWorkbookByNicknames(workbook, nicknames, nameMapping)
      setFilteredWorkbook(filtered)
      setIsFiltered(true)
    } catch (error) {
      console.error('Error filtering file:', error)
      alert('Error filtering file. Please check the file format.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownload = async () => {
    if (!filteredWorkbook) return
    
    const originalName = file?.name.replace(/\.xlsx?$/i, '') || 'filtered'
    await downloadExcelFile(filteredWorkbook, `${originalName}_filtered.xlsx`)
  }

  return (
    <>
      {particles}
      <div className="app-container">
        <h1>Excel Nickname Filter</h1>
        
        <FileUpload 
          file={file} 
          onFileUpload={handleFileUpload} 
          label="Choose Context File"
          id="context-file"
        />

        {file && !isFiltered && (
          <>
            <NicknameInput 
              nicknames={nicknames} 
              onNicknamesChange={setNicknames} 
            />

            <button 
              className="filter-button"
              onClick={handleFilter}
              disabled={isProcessing}
            >
              {isProcessing ? 'Filtering...' : 'Filter'}
            </button>

            {nicknames.length === 0 && (
              <p className="warning-message">
                ⚠️ No nicknames added. The filtered file will be empty.
              </p>
            )}
          </>
        )}

        {isFiltered && (
          <div className="download-section">
            <p className="success-message">✓ File filtered successfully!</p>
            <p className="info-message">
              Filtered {nicknames.length} nickname(s)
            </p>
            <button 
              className="download-button"
              onClick={handleDownload}
            >
              Download Filtered File
            </button>
            <button 
              className="reset-button"
              onClick={() => {
                setIsFiltered(false)
                setFilteredWorkbook(null)
              }}
            >
              Filter Again
            </button>
          </div>
        )}
      </div>
    </>
  )
}

export default App
