import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import './App.css'
import FileUpload from './components/FileUpload'
import NicknameInput from './components/NicknameInput'
import ParticlesBackground from './components/ParticlesBackground'
import { readExcelFile, extractMemberStatistics, filterWorkbookByNicknames, downloadExcelFile } from './utils/excelUtils'
import type { MemberStatistic } from './utils/excelUtils'
import type { NicknameWithLine } from './types'


function App() {
  const [file, setFile] = useState<File | null>(null)
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [filteredWorkbook, setFilteredWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isFiltered, setIsFiltered] = useState(false)
  const [nicknames, setNicknames] = useState<NicknameWithLine[]>([])
  const [memberStatistics, setMemberStatistics] = useState<MemberStatistic[]>([])

  // Memoize ParticlesBackground to prevent re-renders
  const particles = useMemo(() => <ParticlesBackground />, []);

  const handleFileUpload = async (uploadedFile: File) => {
    setFile(uploadedFile)
    setIsFiltered(false)
    setFilteredWorkbook(null)

    let wb: XLSX.WorkBook
    try {
      wb = await readExcelFile(uploadedFile)
    } catch (error) {
      console.error('Error reading file:', error)
      alert(error instanceof Error ? error.message : 'Error reading Excel file. Please make sure it is a valid Excel file.')
      return
    }

    try {
      const stats = extractMemberStatistics(wb)
      setMemberStatistics(stats)
      setNicknames(stats.map(({ nickname }) => ({ nickname, line: undefined })))
    } catch (error) {
      console.error('Error finding active players:', error)
      setMemberStatistics([])
      setNicknames([])
      alert(`${error instanceof Error ? error.message : 'Could not find active players.'} Please enter the players manually.`)
    }
    setWorkbook(wb)
  }

  const handleFilter = () => {
    if (!workbook) return

    setIsProcessing(true)

    try {
      const filtered = filterWorkbookByNicknames(workbook, nicknames, memberStatistics)
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

        {workbook && !isFiltered && (
          <>
            <NicknameInput 
              key={file ? `${file.name}-${file.lastModified}` : undefined}
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
