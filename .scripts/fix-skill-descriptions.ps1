# Fix SKILL.md description blocks to single-line descriptions
# Usage: powershell -NoProfile -File .scripts\fix-skill-descriptions.ps1

$files = Get-ChildItem -Path . -Recurse -Filter SKILL.md -ErrorAction SilentlyContinue
foreach ($file in $files) {
    $text = Get-Content -Raw -Path $file.FullName
    if ($text -match 'description:\s*>') {
        $nameMatch = [regex]::Match($text, 'name:\s*(.+?)\r?\n')
        $name = if ($nameMatch.Success) { $nameMatch.Groups[1].Value.Trim() } else { 'skill' }
        $m = [regex]::Match($text, 'description:\s*>\s*(.*?)\r?\n---', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        if ($m.Success) {
            $block = $m.Groups[1].Value
            $one = ($block -replace '\r?\n',' ' -replace '\s+',' ').Trim()
            # Sanitize internal double quotes to avoid breaking the quoted YAML value
            $one = $one -replace '"', "'"
            if ($one -notmatch '(?i)Triggers on:') { $one += " Triggers on: $name" }
            # Build replacement string using concatenation (safer for PowerShell parsing)
            $new = 'description: "' + $one + '"' + "`n---"
            $text = [regex]::Replace($text, 'description:\s*>\s*.*?\r?\n---', $new, [System.Text.RegularExpressions.RegexOptions]::Singleline)
            Set-Content -Path $file.FullName -Value $text
            Write-Output "Updated: $($file.FullName)"
        } else {
            Write-Output "No matched block in: $($file.FullName)"
        }
    }
}

Write-Output "Done."