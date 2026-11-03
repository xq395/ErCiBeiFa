# 把教务系统导出的"学生个人课表.xls"转成 web/courses.js
# 用法：powershell -ExecutionPolicy Bypass -File 导出课表.ps1 -Xls "C:\...\学生个人课表.xls" -Week1 2027-03-01
param(
  [string]$Xls = "$env:USERPROFILE\Downloads\学生个人课表_20243004845.xls",
  [string]$Week1 = '2026-08-31'  # 第 1 周的周一
)
$ErrorActionPreference='Stop'
$p=$Xls
$B=[IO.File]::ReadAllBytes($p)
$SS=512
$FATSECT=[BitConverter]::ToUInt32($B,0x4C)
$fat=New-Object 'System.Collections.Generic.List[uint32]'
for($i=0;$i -lt 128;$i++){ $fat.Add([BitConverter]::ToUInt32($B, 512+$FATSECT*$SS+4*$i)) }
$dirOff=512+[BitConverter]::ToUInt32($B,0x30)*$SS
$wbStart=0; $wbSize=0
for($i=0;$i -lt 512;$i+=128){
  $nl=[BitConverter]::ToUInt16($B,$dirOff+$i+0x40)
  if($nl -lt 2 -or $nl -gt 64){ continue }
  $nm=[Text.Encoding]::Unicode.GetString($B,$dirOff+$i,$nl-2)
  if($nm -eq 'Workbook'){ $wbStart=[BitConverter]::ToUInt32($B,$dirOff+$i+0x74); $wbSize=[BitConverter]::ToUInt32($B,$dirOff+$i+0x78) }
}
$list=New-Object 'System.Collections.Generic.List[byte]'
$s=[uint32]$wbStart; $g=0
while($s -lt 1000000 -and $g -lt 500){
  $o=512+$s*$SS
  for($i=0;$i -lt $SS;$i++){ if($o+$i -lt $B.Length){ $list.Add($B[$o+$i]) } }
  if($list.Count -ge $wbSize){ break }
  $s=$fat[[int]$s]; $g++
}
$W=$list.ToArray()
$types=New-Object 'System.Collections.Generic.List[int]'; $offs=New-Object 'System.Collections.Generic.List[int]'; $lens=New-Object 'System.Collections.Generic.List[int]'
$pos=0
while($pos -le $W.Length-4){
  $t=[BitConverter]::ToUInt16($W,$pos); $l=[BitConverter]::ToUInt16($W,$pos+2)
  if($t -eq 0 -and $l -eq 0){ break }
  $types.Add([int]$t); $offs.Add($pos+4); $lens.Add([int]$l); $pos += 4+$l
}
$segs=New-Object 'System.Collections.Generic.List[byte[]]'
$sstIdx=-1
for($k=0;$k -lt $types.Count;$k++){ if($types[$k] -eq 252){ $sstIdx=$k; break } }
$seg=New-Object byte[] $lens[$sstIdx]; [Array]::Copy($W,$offs[$sstIdx],$seg,0,$lens[$sstIdx]); $segs.Add($seg)
for($k=$sstIdx+1;$k -lt $types.Count -and $types[$k] -eq 60;$k++){
  $seg2=New-Object byte[] $lens[$k]; [Array]::Copy($W,$offs[$k],$seg2,0,$lens[$k]); $segs.Add($seg2)
}
$st=@{ seg=0; idx=0 }
function _Next([hashtable]$st){ $st.seg++; $st.idx=0; if($st.seg -ge $segs.Count){ return $false }; return $true }
function _Byte([hashtable]$st){ while($st.idx -ge $segs[$st.seg].Length){ if(-not (_Next $st)){ return 0 } }; $v=$segs[$st.seg][$st.idx]; $st.idx++; return $v }
function _U16([hashtable]$st){ $a=_Byte $st; $b=_Byte $st; return ([int]$a -bor ([int]$b -shl 8)) }
function _U32([hashtable]$st){ $a=_Byte $st; $b=_Byte $st; $c=_Byte $st; $d=_Byte $st; return ([int]$a -bor ([int]$b -shl 8) -bor ([int]$c -shl 16) -bor ([int]$d -shl 24)) }
$null=_U32 $st; $uniq=_U32 $st
$ss=New-Object 'System.Collections.Generic.List[string]'
for($q=0;$q -lt $uniq;$q++){
  $cch=_U16 $st; $gr=_Byte $st; $hi=($gr -band 1)
  $rich=(($gr -band 8) -ne 0); $ext=(($gr -band 4) -ne 0)
  $cRun=0; $cbExt=0
  if($rich){ $cRun=_U16 $st }; if($ext){ $cbExt=_U32 $st }
  $sb=New-Object System.Text.StringBuilder; $c=0
  while($c -lt $cch){
    if($st.seg -ge $segs.Count){ break }
    if($st.idx -ge $segs[$st.seg].Length){ if(-not (_Next $st)){break}; $hi=($segs[$st.seg][0] -band 1); $st.idx=1; continue }
    if($hi -eq 1){
      if($st.idx+2 -gt $segs[$st.seg].Length){ if(-not (_Next $st)){break}; $hi=($segs[$st.seg][0] -band 1); $st.idx=1; continue }
      $code=[int]$segs[$st.seg][$st.idx] -bor ([int]$segs[$st.seg][$st.idx+1] -shl 8); $st.idx+=2; [void]$sb.Append([char]$code)
    } else { [void]$sb.Append([char]$segs[$st.seg][$st.idx]); $st.idx+=1 }
    $c++
  }
  $ss.Add($sb.ToString()); $skip=4*$cRun+$cbExt; if($skip -gt 0){ $st.idx += $skip }
}
$grid=@{}
for($k=0;$k -lt $types.Count;$k++){
  $t=$types[$k]; $o=$offs[$k]
  if($t -eq 253){
    $row=[BitConverter]::ToUInt16($W,$o); $col=[BitConverter]::ToUInt16($W,$o+2); $isst=[BitConverter]::ToInt32($W,$o+6)
    if($isst -ge 0 -and $isst -lt $ss.Count){ $grid["$row,$col"]=$ss[$isst] }
  } elseif($t -eq 516){
    $row=[BitConverter]::ToUInt16($W,$o); $col=[BitConverter]::ToUInt16($W,$o+2); $cch=[BitConverter]::ToUInt16($W,$o+6); $gr=$W[$o+8]
    $v = if(($gr -band 1) -ne 0){ [Text.Encoding]::Unicode.GetString($W,$o+9,$cch*2) } else { [Text.Encoding]::Latin1.GetString($W,$o+9,$cch) }
    $grid["$row,$col"]=$v
  }
}

$seen=@{}
$out=New-Object 'System.Collections.Generic.List[object]'
foreach($r in 3..7){ foreach($d in 1..7){
  $txt=$grid["$r,$d"]; if(-not $txt){ continue }
  foreach($block in ($txt -split "`n`n")){
    if($block.Trim() -eq ''){ continue }
    $m=[regex]::Match($block,'([\d,\-]+)\(周\)'); if(-not $m.Success){ continue }
    $lines = @($block -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    $room = (($lines | Where-Object { $_ -match '^\(海甸\)|^\(.*\)\S' }) -join '') -replace '^\([^)]*\)',''
    $per = [regex]::Match($block,'\[([\d\-]+)节\]').Groups[1].Value
    $k = "$($lines[0])|$d|$($m.Groups[1].Value)|$per"
    if($seen[$k]){ continue }; $seen[$k]=1
        $out.Add([pscustomobject]@{ name=$lines[0]; day=$d % 7; weeks=$m.Groups[1].Value; periods=$per; room=$room })
  } } }
$json = ConvertTo-Json -InputObject $out.ToArray() -Depth 3 -Compress
$js = "'use strict';`n// 由 tools/导出课表.ps1 生成，重跑会覆盖`nwindow.TT_COURSES = { week1: '$Week1', list: $json };`n"
$dst = Join-Path $PSScriptRoot '..\web\courses.js'
[IO.File]::WriteAllText($dst, $js, (New-Object Text.UTF8Encoding $false))
$jsonDst = Join-Path $PSScriptRoot "..\courses.json"
[IO.File]::WriteAllText($jsonDst, "{`"week1`":`"$Week1`",`"list`":$json}", (New-Object Text.UTF8Encoding $false))
"已写入 web\courses.js 和 courses.json，共 $($out.Count) 门次。courses.json 可发到手机，在 设置→课表 导入。"
