Add-Type -AssemblyName System.Drawing
$sh = [string][char]0x5C71  # "山" U+5C71
foreach ($size in 192,512) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(163,55,47))
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = [int]($size * 0.22)
  $gp.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
  $gp.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
  $gp.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
  $gp.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
  $gp.CloseFigure()
  $g.FillPath($brush, $gp)
  $font = New-Object System.Drawing.Font('SimSun', [float]($size * 0.72), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,247,234))
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'
  $fmt.LineAlignment = 'Center'
  $rect = New-Object System.Drawing.RectangleF(0, ($size * 0.055), $size, $size)
  $g.DrawString($sh, $font, $white, $rect, $fmt)
  $out = "C:\Users\xiang\Downloads\poetry-site\site\icons\icon-$size.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Output "saved $out"
}
Write-Output 'ICONS_OK'
