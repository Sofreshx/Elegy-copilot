# Clean up double quotes inside description: "..." lines in SKILL.md files
# Removes internal double quotes so Triggers on lists are unquoted

$files = Get-ChildItem -Path . -Recurse -Filter SKILL.md -ErrorAction SilentlyContinue
foreach ($file in $files) {
    $text = Get-Content -Raw -Path $file.FullName
    $m = [regex]::Match($text, 'description:\s*"(.*?)"', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if ($m.Success) {
        $desc = $m.Groups[1].Value
        $newDesc = $desc -replace '"','' -replace '\s+',' ' -replace '\s+,', ','
        $newDesc = $newDesc.Trim()
        $replacement = 'description: "' + $newDesc + '"'
        $text = [regex]::Replace($text, 'description:\s*".*?"', $replacement, [System.Text.RegularExpressions.RegexOptions]::Singleline)
        Set-Content -Path $file.FullName -Value $text
        Write-Output "Cleaned quotes in: $($file.FullName)"
    }
}
Write-Output "Done."