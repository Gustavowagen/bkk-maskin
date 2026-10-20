import { useState, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import '../App.css'
import FileUpload from '../components/FileUpload'
import NicknameInput from '../components/NicknameInput'
import SpreadsheetView from '../components/SpreadsheetView'
import { readExcelFile, isZipFile, extractExcelFromZip,extractMemberStatistics, isActiveMember, findAgentMembers, findPlayersMissingFromBalance, filterWorkbookByNicknames, downloadExcelFile, buildSheetPreview, extractPeriod } from '../utils/excelUtils'
import type { MemberStatistic } from '../utils/excelUtils'
import { fetchPlayerSheet, findRbSetting } from '../utils/playerNames'
import type { PlayerSheetData } from '../utils/playerNames'
import { savePeriod } from '../utils/statsApi'
import { KNOWN_AGENTS, OWNER_RAKEBACK, isDefaultOwner } from '../types'
import type { AgentInput, AgentRow, NicknameWithLine } from '../types'

/**
 * Parse an optional number field ("Ekstra utgifter", "Saldo fra før"). Empty counts as 0; "," or "." may be used as decimal separator.
 * Returns undefined if the text is not a valid number.
 */
const parseOptionalNumber = (text: string): number | undefined => {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  if (!/^-?\d+([.,]\d+)?$/.test(trimmed)) return undefined
  return Number(trimmed.replace(',', '.'))
}

/**
 * Parse the agents list. Empty rows are ignored.
 * A row is invalid if it has a name but no valid rake % (or a rake % / saldo but no name),
 * or if "Saldo fra før" is entered but is not a valid number.
 */
const parseAgents = (rows: AgentRow[]): { agents: AgentInput[]; invalidIds: Set<number> } => {
  const agents: AgentInput[] = []
  const invalidIds = new Set<number>()
  rows.forEach(row => {
    const name = row.name.trim()
    const rakeShareText = row.rakeShareText.trim()
    if (name === '' && rakeShareText === '' && row.previousBalanceText.trim() === '') return
    const previousBalance = parseOptionalNumber(row.previousBalanceText)
    if (name === '' || !/^\d+([.,]\d+)?$/.test(rakeShareText) || previousBalance === undefined) {
      invalidIds.add(row.id)
      return
    }
    // The same agent entered twice only gets one table
    if (agents.some(agent => agent.name.toLowerCase() === name.toLowerCase())) return
    const known = row.known ? KNOWN_AGENTS.find(agent => agent.name === name) : undefined
    agents.push({ ...(known ?? { name, rakeShare: Number(rakeShareText.replace(',', '.')) }), previousBalance })
  })
  return { agents, invalidIds }
}

function MachinePage() {
  const [file, setFile] = useState<File | null>(null)
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [filteredWorkbook, setFilteredWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isFiltered, setIsFiltered] = useState(false)
  const [nicknames, setNicknames] = useState<NicknameWithLine[]>([])
  const [memberStatistics, setMemberStatistics] = useState<MemberStatistic[]>([])
  const [extraExpensesText, setExtraExpensesText] = useState('')
  const [playerNamesError, setPlayerNamesError] = useState<string | null>(null)
  // Real names and rb settings from Google Sheets, fetched on upload (null if that failed)
  const [playerSheet, setPlayerSheet] = useState<PlayerSheetData | null>(null)
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(false)
  // Only the latest upload may fill in the player table
  const uploadIdRef = useRef(0)
  const [agentRows, setAgentRows] = useState<AgentRow[]>(() => [
    ...KNOWN_AGENTS.map((agent, i): AgentRow => ({ id: i, name: agent.name, rakeShareText: String(agent.rakeShare), previousBalanceText: '', known: true })),
    { id: KNOWN_AGENTS.length, name: '', rakeShareText: '', previousBalanceText: '' },
  ])
  // Uncheck when testing, so the statistics are not updated
  const [updateData, setUpdateData] = useState(true)
  const [statsStatus, setStatsStatus] = useState<{ kind: 'saved' | 'skipped' | 'error'; message: string } | null>(null)

  const extraExpenses = parseOptionalNumber(extraExpensesText)
  const { agents: enteredAgents, invalidIds: invalidAgentIds } = parseAgents(agentRows)
  // Remembered agents with no players in this file and no Saldo fra før get no table
  const agents = enteredAgents.filter(agent =>
    !KNOWN_AGENTS.some(known => known.name === agent.name) ||
    agent.previousBalance !== 0 ||
    findAgentMembers(memberStatistics, agent.name).length > 0
  )
  const inputInvalid = extraExpenses === undefined || invalidAgentIds.size > 0

  // Agents typed in the agents list and their players go to the agent tables, where line and rakeback
  // are ignored, so they are hidden from the player table (lowercase nicknames)
  const agentPlayerNicknames = useMemo(() => new Set(
    agentRows
      .map(row => row.name.trim())
      .filter(name => name !== '')
      .flatMap(name => findAgentMembers(memberStatistics, name).map(m => m.nickname.trim().toLowerCase()))
  ), [agentRows, memberStatistics])

  // Same styled sheet as the download, shown in the app so cells can be copied straight into Excel
  const sheetPreview = useMemo(() => {
    if (!filteredWorkbook) return null
    try {
      return buildSheetPreview(filteredWorkbook)
    } catch (error) {
      console.error('Error building sheet preview:', error)
      return null
    }
  }, [filteredWorkbook])


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

  /**
   * Fetch the player sheet from Google Sheets. Returns null (and shows a warning) if that fails.
   */
  const loadPlayerSheet = async (): Promise<PlayerSheetData | null> => {
    try {
      const sheet = await fetchPlayerSheet()
      setPlayerNamesError(null)
      return sheet
    } catch (error) {
      console.error('Error fetching player sheet:', error)
      setPlayerNamesError(error instanceof Error ? error.message : 'Could not fetch real names.')
      return null
    }
  }

  const handleFileUpload = async (droppedFile: File) => {
    const uploadId = ++uploadIdRef.current

    let uploadedFile = droppedFile
    if (isZipFile(droppedFile)) {
      try {
        uploadedFile = await extractExcelFromZip(droppedFile)
      } catch (error) {
        console.error('Error unzipping file:', error)
        alert(error instanceof Error ? error.message : 'Could not open the zip file.')
        return
      }
      if (uploadId !== uploadIdRef.current) return
    }

    setFile(uploadedFile)
    setIsFiltered(false)
    setFilteredWorkbook(null)
    setExtraExpensesText('')
    setWorkbook(null)

    // The player sheet is fetched while the file is read, so the rb column can pre-fill the player table
    setIsLoadingPlayers(true)
    const playerSheetPromise = loadPlayerSheet()

    let wb: XLSX.WorkBook
    try {
      wb = await readExcelFile(uploadedFile)
    } catch (error) {
      console.error('Error reading file:', error)
      if (uploadId === uploadIdRef.current) setIsLoadingPlayers(false)
      alert(error instanceof Error ? error.message : 'Error reading Excel file. Please make sure it is a valid Excel file.')
      return
    }

    const sheet = await playerSheetPromise
    if (uploadId !== uploadIdRef.current) return
    setPlayerSheet(sheet)
    setIsLoadingPlayers(false)

    try {
      const stats = extractMemberStatistics(wb)
      setMemberStatistics(stats)
      setNicknames(stats.filter(isActiveMember).map(({ nickname }): NicknameWithLine => {
        // The "rb" column decides owner / rakeback; when it is blank the default owners still apply
        const rbSetting = sheet ? findRbSetting(sheet.rbSettings, nickname) : undefined
        if (rbSetting?.owner || (!rbSetting && isDefaultOwner(nickname))) {
          return { nickname, line: undefined, rakeback: OWNER_RAKEBACK, owner: true }
        }
        return { nickname, line: undefined, rakeback: rbSetting?.rakeback }
      }))
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

    // Real names come from Google Sheets (fetched on upload, retried here if that failed);
    // without them the "Navn" column is left blank
    let sheet = playerSheet
    if (!sheet) {
      sheet = await loadPlayerSheet()
      setPlayerSheet(sheet)
    }
    const realNames = sheet?.realNames ?? new Map<string, string>()

    let result: ReturnType<typeof filterWorkbookByNicknames>
    try {
      result = filterWorkbookByNicknames(workbook, nicknames, memberStatistics, extraExpenses, realNames, agents)
    } catch (error) {
      console.error('Error filtering file:', error)
      alert('Error filtering file. Please check the file format.')
      setIsProcessing(false)
      return
    }

    if (!updateData) {
      setStatsStatus({ kind: 'skipped', message: 'Statistics were not updated ("Update data" was unchecked).' })
    } else {
      const period = extractPeriod(workbook)
      if (!period) {
        setStatsStatus({ kind: 'error', message: 'Statistics were not updated: could not find "Period" at the top of the "Member Statistics" sheet.' })
      } else {
        try {
          await savePeriod(period, result.summary, file?.name ?? '')
          const range = period.start === period.end ? period.start : `${period.start} – ${period.end}`
          setStatsStatus({ kind: 'saved', message: `Statistics updated for ${range}.` })
        } catch (error) {
          console.error('Error saving statistics:', error)
          setStatsStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Could not save statistics.' })
        }
      }
    }

    setFilteredWorkbook(result.workbook)
    setIsFiltered(true)
    setIsProcessing(false)
  }

  const handleDownload = async () => {
    if (!filteredWorkbook) return

    const originalName = file?.name.replace(/\.xlsx?$/i, '') || 'filtered'
    await downloadExcelFile(filteredWorkbook, `${originalName}_filtered.xlsx`)
  }

  return (
    <>
      <div className="app-container">
        <h1>Excel Nickname Filter</h1>
        
        <FileUpload 
          file={file} 
          onFileUpload={handleFileUpload} 
          label="Choose Context File"
          id="context-file"
        />

        {isLoadingPlayers && (
          <div className="players-loading" role="status" aria-live="polite">
            <div className="players-loading-header">
              <span className="loading-spinner" aria-hidden="true" />
              <span className="info-message">Loading players from Google Sheets...</span>
            </div>
            <div className="skeleton-rows" aria-hidden="true">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="skeleton-row" style={{ animationDelay: `${i * 0.08}s` }}>
                  <span className="skeleton-cell" />
                  <span className="skeleton-cell" />
                  <span className="skeleton-cell" />
                  <span className="skeleton-cell skeleton-cell-narrow" />
                </div>
              ))}
            </div>
          </div>
        )}

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
              agentPlayerNicknames={agentPlayerNicknames}
            />

            <label className="update-data-option">
              <input type="checkbox" checked={updateData} onChange={e => setUpdateData(e.target.checked)} />
              <span>
                Update data
                <small>Saves this period to the statistics. Uncheck when testing.</small>
              </span>
            </label>

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
            {playerNamesError && (
              <p className="warning-message">
                ⚠️ {playerNamesError} Rakeback and owners from the "rb" column are not filled in.
              </p>
            )}
          </>
        )}

        {isFiltered && (
          <div className="download-section">
            <p className="success-message">✓ File filtered successfully!</p>
            {statsStatus && (
              <p className={statsStatus.kind === 'error' ? 'warning-message' : 'info-message'}>
                {statsStatus.kind === 'saved' ? '✓ ' : statsStatus.kind === 'error' ? '⚠️ ' : ''}{statsStatus.message}
              </p>
            )}
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

        {isFiltered && sheetPreview && <SpreadsheetView sheet={sheetPreview} />}
      </div>
    </>
  )
}

export default MachinePage
