import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import './App.css'
import FileUpload from './components/FileUpload'
import NicknameInput from './components/NicknameInput'
import ParticlesBackground from './components/ParticlesBackground'
import { readExcelFile, extractMemberStatistics, isActiveMember, findAgentMembers, findPlayersMissingFromBalance, filterWorkbookByNicknames, downloadExcelFile } from './utils/excelUtils'
import type { MemberStatistic } from './utils/excelUtils'
import { fetchPlayerNames } from './utils/playerNames'
import { OWNER_RAKEBACK, isDefaultOwner } from './types'
import type { AgentInput, AgentRow, NicknameWithLine } from './types'

/**
 * Parse the "Ekstra utgifter" field. Empty counts as 0; "," or "." may be used as decimal separator.
 * Returns undefined if the text is not a valid number.
 */
const parseExtraExpenses = (text: string): number | undefined => {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  if (!/^-?\d+([.,]\d+)?$/.test(trimmed)) return undefined
  return Number(trimmed.replace(',', '.'))
}

/**
 * Parse the agents list. Rows with neither a name nor a rake % are ignored.
 * A row is invalid if it has a name but no valid rake % (or a rake % but no name).
 */
const parseAgents = (rows: AgentRow[]): { agents: AgentInput[]; invalidIds: Set<number> } => {
  const agents: AgentInput[] = []
  const invalidIds = new Set<number>()
  rows.forEach(row => {
    const name = row.name.trim()
    const rakeShareText = row.rakeShareText.trim()
    if (name === '' && rakeShareText === '') return
    if (name === '' || !/^\d+([.,]\d+)?$/.test(rakeShareText)) {
      invalidIds.add(row.id)
      return
    }
    // The same agent entered twice only gets one table
    if (agents.some(agent => agent.name.toLowerCase() === name.toLowerCase())) return
    agents.push({ name, rakeShare: Number(rakeShareText.replace(',', '.')) })
  })
  return { agents, invalidIds }
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [filteredWorkbook, setFilteredWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isFiltered, setIsFiltered] = useState(false)
  const [nicknames, setNicknames] = useState<NicknameWithLine[]>([])
  const [memberStatistics, setMemberStatistics] = useState<MemberStatistic[]>([])
  const [extraExpensesText, setExtraExpensesText] = useState('')
  const [playerNamesError, setPlayerNamesError] = useState<string | null>(null)
  const [agentRows, setAgentRows] = useState<AgentRow[]>([{ id: 0, name: '', rakeShareText: '' }])

  const extraExpenses = parseExtraExpenses(extraExpensesText)
  const { agents, invalidIds: invalidAgentIds } = parseAgents(agentRows)
  const inputInvalid = extraExpenses === undefined || invalidAgentIds.size > 0

  // Memoize ParticlesBackground to prevent re-renders
  const particles = useMemo(() => <ParticlesBackground />, []);

  // Players without a "Club Member Balance" row; they are added to the document with 0 chips
  const missingPlayers = useMemo(() => {
    if (!workbook) return []
    try {
      return findPlayersMissingFromBalance(workbook, nicknames)
    } catch {
      return []
    }
  }, [workbook, nicknames])

  const missingPlayersWarning = missingPlayers.length > 0 && (
    <p className="warning-message">
      ⚠️ {missingPlayers.length} player(s) not found in the "Club Member Balance" sheet and added as "Left Club?" (counted as 0 chips):{' '}
      <strong>{missingPlayers.map(p => p.nickname).join(', ')}</strong>
    </p>
  )

  // Agents without any players or own row in "Member Statistics" get an empty table
  const agentsWithoutMembers = agents.filter(agent => findAgentMembers(memberStatistics, agent.name).length === 0)
  const agentsWarning = agentsWithoutMembers.length > 0 && (
    <p className="warning-message">
      ⚠️ No players found for agent(s) in the "Member Statistics" sheet:{' '}
      <strong>{agentsWithoutMembers.map(agent => agent.name).join(', ')}</strong>
    </p>
  )

  const handleFileUpload = async (uploadedFile: File) => {
    setFile(uploadedFile)
    setIsFiltered(false)
    setFilteredWorkbook(null)
    setExtraExpensesText('')

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
      setNicknames(stats.filter(isActiveMember).map(({ nickname }) =>
        isDefaultOwner(nickname)
          ? { nickname, line: undefined, rakeback: OWNER_RAKEBACK, owner: true }
          : { nickname, line: undefined }
      ))
    } catch (error) {
      console.error('Error finding active players:', error)
      setMemberStatistics([])
      setNicknames([])
      alert(`${error instanceof Error ? error.message : 'Could not find active players.'} Please enter the players manually.`)
    }
    setWorkbook(wb)
  }

  const handleFilter = async () => {
    if (!workbook || extraExpenses === undefined || inputInvalid) return

    setIsProcessing(true)

    // Real names come from Google Sheets; without them the "Navn" column is left blank
    let realNames = new Map<string, string>()
    try {
      realNames = await fetchPlayerNames()
      setPlayerNamesError(null)
    } catch (error) {
      console.error('Error fetching real names:', error)
      setPlayerNamesError(error instanceof Error ? error.message : 'Could not fetch real names.')
    }

    try {
      const filtered = filterWorkbookByNicknames(workbook, nicknames, memberStatistics, extraExpenses, realNames, agents)
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
              extraExpensesText={extraExpensesText}
              onExtraExpensesTextChange={setExtraExpensesText}
              extraExpensesInvalid={extraExpenses === undefined}
              agentRows={agentRows}
              onAgentRowsChange={setAgentRows}
              invalidAgentIds={invalidAgentIds}
            />

            <button 
              className="filter-button"
              onClick={handleFilter}
              disabled={isProcessing || inputInvalid}
            >
              {isProcessing ? 'Filtering...' : 'Filter'}
            </button>

            {nicknames.length === 0 && (
              <p className="warning-message">
                ⚠️ No nicknames added. The filtered file will be empty.
              </p>
            )}

            {missingPlayersWarning}
            {agentsWarning}
          </>
        )}

        {isFiltered && (
          <div className="download-section">
            <p className="success-message">✓ File filtered successfully!</p>
            <p className="info-message">
              Filtered {nicknames.length} nickname(s)
            </p>
            {missingPlayersWarning}
            {playerNamesError && (
              <p className="warning-message">
                ⚠️ {playerNamesError} The "Navn" column is left blank.
              </p>
            )}
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
