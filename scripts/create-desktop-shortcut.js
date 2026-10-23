const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

try {
  const desktopDir = path.join(os.homedir(), 'Desktop');
  const projectDir = path.join(__dirname, '..');
  const targetExe = path.join(projectDir, 'release', 'win-unpacked', 'Sole What.exe');
  const workingDir = path.join(projectDir, 'release', 'win-unpacked');
  const iconPath = path.join(projectDir, 'assets', 'icon.ico');
  const shortcutPath = path.join(desktopDir, 'Sole What POS.lnk');

  const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/\\/g, '\\\\')}')
$Shortcut.TargetPath = '${targetExe.replace(/\\/g, '\\\\')}'
$Shortcut.WorkingDirectory = '${workingDir.replace(/\\/g, '\\\\')}'
$Shortcut.IconLocation = '${iconPath.replace(/\\/g, '\\\\')}'
$Shortcut.Save()
`;

  execSync(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, '; ')}"`, { stdio: 'inherit' });
  console.log('[SUCCESS] Desktop shortcut created at:', shortcutPath);
} catch (err) {
  console.error('[ERROR] Failed to create shortcut:', err.message);
}
