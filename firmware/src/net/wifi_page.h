#pragma once
// /wifi の HTML（PROGMEM。LittleFS が空でも出る）。駅のサイン風の黒地・太いゴシック。
#include <pgmspace.h>
static const char WIFI_PAGE[] PROGMEM = R"HTML(<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wi-Fi 設定 - 焙煎記録ノート</title>
<style>
body{margin:0;background:#111;color:#f4f4f4;font:16px/1.6 -apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:30rem;margin:0 auto;padding:1rem}
h1{font-size:1.25rem;border-bottom:3px solid #c2410c;padding-bottom:.4rem}
label{display:block;margin:.9rem 0 .2rem;font-weight:700}
input,select,button{width:100%;box-sizing:border-box;font:inherit;padding:.6rem;border:2px solid #555;background:#1c1c1c;color:#fff;border-radius:4px}
button{background:#c2410c;border-color:#c2410c;font-weight:700;margin-top:1rem}
button.sub{background:#1c1c1c;border-color:#555}
#msg{margin-top:1rem;min-height:1.5rem;color:#fbbf24}
small{color:#aaa}
a{color:#fbbf24}
</style></head><body><main>
<h1>Wi-Fi 設定</h1>
<p><small>家の Wi-Fi につなぐと、スマホからこの機器を roast.local で開けます。つながらないときは、この機器自身の Wi-Fi（RoastLog-XXXX）で使えます。</small></p>
<button class="sub" id="scan" type="button">まわりの Wi-Fi を探す</button>
<label for="list">見つかった Wi-Fi</label>
<select id="list"><option value="">（探してください）</option></select>
<label for="ssid">Wi-Fi の名前</label><input id="ssid" autocapitalize="none" autocomplete="off">
<label for="pass">パスワード</label><input id="pass" type="password" autocomplete="off">
<label for="host">機器の名前（roast.local の roast の部分。省略可）</label><input id="host" placeholder="roast" autocapitalize="none">
<button id="save" type="button">保存して再起動</button>
<p id="msg"></p>
<p><a href="/">アプリにもどる</a></p>
<script>
const $=id=>document.getElementById(id);
async function scan(){
  $('msg').textContent='探しています…';
  for(let i=0;i<12;i++){
    try{
      const r=await (await fetch('/api/scan')).json();
      if(!r.scanning){
        const l=$('list'); l.innerHTML='<option value="">（選んでください）</option>';
        r.networks.sort((a,b)=>b.rssi-a.rssi).forEach(n=>{const o=document.createElement('option');o.value=n.ssid;o.textContent=n.ssid+(n.open?'（鍵なし）':'')+'  '+n.rssi+'dBm';l.appendChild(o);});
        $('msg').textContent=r.networks.length+' 件見つかりました';return;
      }
    }catch(e){}
    await new Promise(r=>setTimeout(r,1000));
  }
  $('msg').textContent='見つかりませんでした。名前を直接入れてください。';
}
$('scan').onclick=scan;
$('list').onchange=e=>{if(e.target.value)$('ssid').value=e.target.value;};
$('save').onclick=async()=>{
  const ssid=$('ssid').value.trim(); if(!ssid){$('msg').textContent='Wi-Fi の名前を入れてください';return;}
  const body={ssid,pass:$('pass').value}; const h=$('host').value.trim(); if(h)body.host=h;
  try{
    const r=await fetch('/api/wifi',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    const E={closed:'いまは設定を受け付けていません。機器自身の Wi-Fi（RoastLog-XXXX）につないでこのページを開くか、機器のボタンを短く押してから 60 秒以内にもう一度保存してください。',bad_pass:'Wi-Fi のパスワードは 8〜63 文字です（鍵のない Wi-Fi は空にします）。',bad_ssid:'Wi-Fi の名前は 1〜32 文字です。',bad_host:'機器の名前は英小文字・数字・ハイフンだけ（32 文字まで）です。',too_large:'送る内容が大きすぎます。',bad_origin:'このページを機器から開き直してください。',need_json:'送り方が正しくありません。ページを読み込み直してください。'};
    $('msg').textContent=j.ok?'保存しました。機器が再起動します。20 秒ほどしたら、家の Wi-Fi につないだスマホで http://'+(h||'roast')+'.local を開いてください。':('保存できませんでした。'+(E[j.err]||j.err||''));
  }catch(e){$('msg').textContent='通信できませんでした';}
};
</script></main></body></html>)HTML";
