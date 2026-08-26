import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const motionParameterNames: Record<number, string> = {
  1: 'AFAP',
  2: 'Process',
  3: 'SmoothProcess'
};

interface FoldSelection {
  moveType: string;
  pointName: string;
  isGlobalPoint: boolean;
  blendingEnabled: boolean;
  apxEnabled: boolean;
  velocity: string;
  velocityKey: string;
  unit: string;
  moveDataName: string;
  moveDataKey: string;
  toolIndex?: number;
  baseIndex?: number;
  fdatName?: string;
  collisionIndex: number;
  motionParamSetIndex?: number;
  motionParamName?: string;
  ilfProvider: string;
  indent: string;
  contEnabled: boolean;
}

interface ToolBaseNames {
  toolNames: Map<number, string>;
  baseNames: Map<number, string>;
}

interface FdatValues {
  toolNo?: number;
  baseNo?: number;
}

export async function convertSelectionToIiqkaFold(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('KRL-HELPER: No active editor found.');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showErrorMessage('KRL-HELPER: Please select a KRL fold block to convert.');
    return;
  }

  const selectedText = editor.document.getText(selection);
  if (/^\s*;FOLD\b/im.test(selectedText) || /^\s*;ENDFOLD\b/im.test(selectedText)) {
    vscode.window.showErrorMessage('KRL-HELPER: Select only the KRL motion block (without any ;FOLD / ;ENDFOLD).');
    return;
  }

  const eol = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const parsed = parseFoldSelection(selectedText);
  if (!parsed) {
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('KRL-HELPER: No workspace folder found for the active file.');
    return;
  }

  let toolIndex = parsed.toolIndex;
  let baseIndex = parsed.baseIndex;
  let configDatPath: string | null = null;

  if ((toolIndex === undefined || baseIndex === undefined) && parsed.fdatName) {
    let fdatFilePath: string | null = null;
    if (parsed.isGlobalPoint) {
      configDatPath = await findConfigDat(workspaceFolder, editor.document.uri.fsPath);
      if (!configDatPath) {
        vscode.window.showErrorMessage('KRL-HELPER: Could not locate KRC/R1/System/$config.dat in the workspace.');
        return;
      }
      fdatFilePath = findGlobalPointsDat(configDatPath);
      if (!fdatFilePath) {
        vscode.window.showErrorMessage('KRL-HELPER: Global_Points.dat not found next to $config.dat.');
        return;
      }
    } else {
      fdatFilePath = findCompanionDat(editor.document.uri.fsPath);
      if (!fdatFilePath) {
        vscode.window.showErrorMessage('KRL-HELPER: Companion .dat file not found to resolve TOOL_NO/BASE_NO.');
        return;
      }
    }

    let fdatText: string;
    try {
      fdatText = await fs.promises.readFile(fdatFilePath, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`KRL-HELPER: Failed to read ${fdatFilePath}. ${message}`);
      return;
    }

    let fdatValues = readFdatValues(fdatText, parsed.fdatName);
    if (parsed.isGlobalPoint) {
      const nameWithoutGlobalPrefix = parsed.fdatName.replace(/^g/i, '');
      if (nameWithoutGlobalPrefix && nameWithoutGlobalPrefix !== parsed.fdatName
          && (fdatValues.toolNo === undefined || fdatValues.baseNo === undefined)) {
        const fallbackValues = readFdatValues(fdatText, nameWithoutGlobalPrefix);
        fdatValues = {
          toolNo: fdatValues.toolNo ?? fallbackValues.toolNo,
          baseNo: fdatValues.baseNo ?? fallbackValues.baseNo
        };
      }
    }

    toolIndex ??= fdatValues.toolNo;
    baseIndex ??= fdatValues.baseNo;
  }

  if (toolIndex === undefined || baseIndex === undefined) {
    const source = parsed.isGlobalPoint ? 'Global_Points.dat' : 'companion .dat file';
    vscode.window.showErrorMessage(`KRL-HELPER: Tool/Base index not found in selection or ${source}.`);
    return;
  }

  configDatPath ??= await findConfigDat(workspaceFolder, editor.document.uri.fsPath);
  if (!configDatPath) {
    vscode.window.showErrorMessage('KRL-HELPER: Could not locate KRC/R1/System/$config.dat in the workspace.');
    return;
  }

  let configText: string;
  try {
    configText = await fs.promises.readFile(configDatPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`KRL-HELPER: Failed to read ${configDatPath}. ${message}`);
    return;
  }

  const { toolNames, baseNames } = parseToolBaseNames(configText);
  const toolLabel = formatToolBaseLabel('Tool', toolIndex, toolNames.get(toolIndex));
  const baseLabel = formatToolBaseLabel('Base', baseIndex, baseNames.get(baseIndex));

  const headerParts = [`;FOLD ${parsed.moveType} ${parsed.pointName}`];
  if (parsed.contEnabled) {
    headerParts.push('CONT');
    if (parsed.motionParamName) {
      headerParts.push(parsed.motionParamName);
    }
  }
  headerParts.push(
    `Vel=${parsed.velocity}`,
    parsed.unit,
    parsed.moveDataName,
    toolLabel,
    baseLabel
  );
  if (parsed.collisionIndex > 0) {
    headerParts.push(`ColDetect[${parsed.collisionIndex}]`);
  }
  headerParts.push(';%{PE}');

  const parameterParts = [
    `IlfProvider=${parsed.ilfProvider}`,
    `Kuka.IsGlobalPoint=${krlBoolean(parsed.isGlobalPoint)}`,
    `Kuka.PointName=${parsed.pointName}`,
    `Kuka.BlendingEnabled=${krlBoolean(parsed.blendingEnabled)}`,
    `Kuka.APXEnabled=${krlBoolean(parsed.apxEnabled)}`,
    `${parsed.moveDataKey}=${parsed.moveDataName}`,
    `Kuka.${parsed.velocityKey}=${parsed.velocity}`,
    `Kuka.CurrentCDSetIndex=${parsed.collisionIndex}`
  ];
  if (parsed.motionParamSetIndex !== undefined) {
    parameterParts.push(`Kuka.MovementParamSetIndex=${parsed.motionParamSetIndex}`);
  }
  parameterParts.push(`IlfCommand=${parsed.moveType}`);

  const replacementLines = [
    `${parsed.indent}${headerParts.join(' ')}`,
    `${parsed.indent};FOLD Parameters ;%{h}`,
    `${parsed.indent};Params ${parameterParts.join('; ')}`,
    `${parsed.indent};ENDFOLD`,
    ...selectedText.split(/\r?\n/),
    `${parsed.indent};ENDFOLD`
  ];

  await editor.edit(editBuilder => {
    editBuilder.replace(selection, replacementLines.join(eol));
  });
}

function parseFoldSelection(text: string): FoldSelection | null {
  const indent = text.split(/\r?\n/).find(line => line.trim().length > 0)?.match(/^\s*/)?.[0] ?? '';
  const toolIndex = firstIntegerMatch(text, [
    /\bTool\[(\d+)\]/i,
    /\$TOOL\s*=\s*TOOL_DATA\[(\d+)\]/i,
    /BAS\s*\(\s*#TOOL\s*,\s*(\d+)\s*\)/i
  ]);
  const baseIndex = firstIntegerMatch(text, [
    /\bBase\[(\d+)\]/i,
    /\$BASE\s*=\s*BASE_DATA\[(\d+)\]/i,
    /BAS\s*\(\s*#BASE\s*,\s*(\d+)\s*\)/i
  ]);
  const fdatName = text.match(/FDAT_ACT\s*=\s*([A-Za-z0-9_]+)/i)?.[1];
  const movementMatch = text.match(/^\s*(PTP|LIN|SPTP|SLIN)\s+([gG]?X[^\s;]+)/m);
  if (!movementMatch) {
    vscode.window.showErrorMessage('KRL-HELPER: Could not find a movement line (PTP/LIN/SPTP/SLIN) in the selection.');
    return null;
  }

  const moveType = movementMatch[1].toUpperCase();
  const movementLine = movementMatch[0];
  const rawPointName = movementMatch[2];
  const isGlobalPoint = /^gX/i.test(rawPointName);
  const pointName = rawPointName.replace(/^g?X/i, '').replace(/[<>]/g, '');
  const blendingPattern = /C_(DIS|APX|APS)/i;
  const apxPattern = /C_(APX|APS)/i;
  const blendingEnabled = blendingPattern.test(movementLine) || blendingPattern.test(text);
  const apxEnabled = apxPattern.test(movementLine) || apxPattern.test(text);
  const velocity = text.match(/BAS\s*\(\s*#(PTP|CP)_PARAMS\s*,\s*([0-9.]+)\s*\)/i)?.[2] ?? '';
  if (!velocity) {
    vscode.window.showErrorMessage('KRL-HELPER: Velocity not found (BAS(#PTP_PARAMS|#CP_PARAMS, ...)).');
    return null;
  }

  const isPtp = moveType === 'PTP' || moveType === 'SPTP';
  const unit = isPtp ? '%' : 'm/s';
  const velocityKey = isPtp ? 'VelocityPtp' : 'VelocityPath';
  const moveDataKey = isPtp ? 'Kuka.MoveDataPtpName' : 'Kuka.MoveDataName';
  const rawMoveDataName = isPtp
    ? text.match(/PDAT_ACT\s*=\s*([A-Za-z0-9_]+)/i)?.[1] ?? ''
    : text.match(/LDAT_ACT\s*=\s*([A-Za-z0-9_]+)/i)?.[1] ?? '';
  if (!rawMoveDataName) {
    vscode.window.showErrorMessage('KRL-HELPER: Move data not found (PDAT_ACT/LDAT_ACT).');
    return null;
  }

  const upperMoveDataName = rawMoveDataName.toUpperCase();
  const moveDataName = upperMoveDataName.startsWith('PPDAT') || upperMoveDataName.startsWith('LCPDAT')
    ? rawMoveDataName.substring(1)
    : rawMoveDataName;
  const collisionIndex = integerMatch(text, /SET_CD_PARAMS\s*\(\s*(\d+)\s*\)/i, 0) ?? 0;
  const motionParamSetIndex = integerMatch(text, /SET_MOTIONPARAMSET\s*\(\s*(\d+)\s*\)/i);
  const motionParamName = motionParamSetIndex !== undefined
    ? motionParameterNames[motionParamSetIndex]
    : undefined;

  return {
    moveType,
    pointName,
    isGlobalPoint,
    blendingEnabled,
    apxEnabled,
    velocity,
    velocityKey,
    unit,
    moveDataName,
    moveDataKey,
    toolIndex,
    baseIndex,
    fdatName,
    collisionIndex,
    motionParamSetIndex,
    motionParamName,
    ilfProvider: moveType === 'SPTP' || moveType === 'SLIN'
      ? 'kukaroboter.basistech.inlineforms.movement.spline'
      : 'kukaroboter.basistech.inlineforms.movement.old',
    indent,
    contEnabled: blendingEnabled || motionParamSetIndex !== undefined
  };
}

function integerMatch(text: string, regex: RegExp, fallback?: number): number | undefined {
  const match = text.match(regex);
  if (!match) {
    return fallback;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isNaN(value) ? fallback : value;
}

function firstIntegerMatch(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = Number.parseInt(match[1], 10);
      if (!Number.isNaN(value)) {
        return value;
      }
    }
  }
  return undefined;
}

function krlBoolean(value: boolean): string {
  return value ? 'True' : 'False';
}

async function findConfigDat(workspaceFolder: vscode.WorkspaceFolder, sourceFile: string): Promise<string | null> {
  const projectRoot = findProjectRoot(sourceFile);
  if (projectRoot) {
    const directPath = path.join(projectRoot, 'KRC', 'R1', 'System', '$config.dat');
    if (fs.existsSync(directPath)) {
      return directPath;
    }
  }

  const systemCandidates = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, '**/KRC/R1/System/$config.dat'),
    '**/node_modules/**',
    25
  );
  if (systemCandidates.length > 0) {
    return nearestPath(sourceFile, systemCandidates.map(uri => uri.fsPath));
  }

  const anyCandidates = await vscode.workspace.findFiles(
    new vscode.RelativePattern(workspaceFolder, '**/$config.dat'),
    '**/node_modules/**',
    25
  );
  return anyCandidates.length > 0
    ? nearestPath(sourceFile, anyCandidates.map(uri => uri.fsPath))
    : null;
}

function findProjectRoot(filePath: string): string | null {
  const normalized = path.normalize(filePath);
  const parsed = path.parse(normalized);
  const parts = normalized.slice(parsed.root.length).split(path.sep).filter(part => part.length > 0);
  const krcIndex = parts.lastIndexOf('KRC');
  if (krcIndex !== -1 && parts[krcIndex + 1] === 'R1') {
    return path.join(parsed.root, ...parts.slice(0, krcIndex));
  }
  return null;
}

function pathDistance(leftPath: string, rightPath: string): number {
  const left = path.normalize(leftPath).split(path.sep).filter(part => part.length > 0);
  const right = path.normalize(rightPath).split(path.sep).filter(part => part.length > 0);
  let common = 0;
  const limit = Math.min(left.length, right.length);
  while (common < limit && left[common] === right[common]) {
    common += 1;
  }
  return (left.length - common) + (right.length - common);
}

function nearestPath(sourceFile: string, candidates: string[]): string {
  let nearest = candidates[0];
  let nearestDistance = pathDistance(sourceFile, nearest);
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const distance = pathDistance(sourceFile, candidate);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = candidate;
    }
  }
  return nearest;
}

function parseToolBaseNames(configText: string): ToolBaseNames {
  return {
    toolNames: parseNameAssignments(configText, 'TOOL_NAME'),
    baseNames: parseNameAssignments(configText, 'BASE_NAME')
  };
}

function parseNameAssignments(configText: string, variableName: string): Map<number, string> {
  const names = new Map<number, string>();
  const regex = new RegExp(`^\\s*${variableName}\\[(\\d+)[^\\]]*\\]\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gmi');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(configText))) {
    const index = Number.parseInt(match[1], 10);
    if (Number.isNaN(index)) {
      continue;
    }
    const name = (match[2] ?? match[3] ?? '').trim();
    if (name) {
      names.set(index, name);
    }
  }
  return names;
}

function formatToolBaseLabel(label: string, index: number, name?: string): string {
  const trimmedName = name?.trim();
  return trimmedName ? `${label}[${index}]:${trimmedName}` : `${label}[${index}]`;
}

function findCompanionDat(sourceFile: string): string | null {
  const directory = path.dirname(sourceFile);
  const baseName = path.basename(sourceFile, path.extname(sourceFile));
  const lowerCasePath = path.join(directory, `${baseName}.dat`);
  if (fs.existsSync(lowerCasePath)) {
    return lowerCasePath;
  }
  const upperCasePath = path.join(directory, `${baseName}.DAT`);
  return fs.existsSync(upperCasePath) ? upperCasePath : null;
}

function findGlobalPointsDat(configDatPath: string): string | null {
  const directory = path.dirname(configDatPath);
  const lowerCasePath = path.join(directory, 'Global_Points.dat');
  if (fs.existsSync(lowerCasePath)) {
    return lowerCasePath;
  }
  const upperCasePath = path.join(directory, 'Global_Points.DAT');
  return fs.existsSync(upperCasePath) ? upperCasePath : null;
}

function readFdatValues(datText: string, fdatName: string): FdatValues {
  const escapedName = escapeRegex(fdatName);
  const regex = new RegExp(
    `(?:GLOBAL\\s+)?DECL\\s+(?:GLOBAL\\s+)?FDAT\\s+${escapedName}\\s*=?\\s*\\{([\\s\\S]*?)\\}`,
    'i'
  );
  const match = datText.match(regex);
  if (!match) {
    return {};
  }

  const body = match[1];
  const toolMatch = body.match(/TOOL_NO\s*=?\s*(\d+)/i);
  const baseMatch = body.match(/BASE_NO\s*=?\s*(\d+)/i);
  const toolNo = toolMatch ? Number.parseInt(toolMatch[1], 10) : undefined;
  const baseNo = baseMatch ? Number.parseInt(baseMatch[1], 10) : undefined;
  return {
    toolNo: Number.isNaN(toolNo) ? undefined : toolNo,
    baseNo: Number.isNaN(baseNo) ? undefined : baseNo
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
