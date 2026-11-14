import test from 'node:test';
import assert from 'node:assert/strict';
import {allowLiveFullscreen} from '../src/live-window-permissions.ts';
const desk={isDestroyed:()=>false,getURL:()=> 'bcc://app/live.html'};
const details={isMainFrame:true,requestingUrl:'bcc://app/live.html'};
test('V107 fullscreen allows only the current trusted top-level desk',()=>{
  assert.equal(allowLiveFullscreen('fullscreen',desk,desk,details),true);
});
test('V107 fullscreen does not grant other browser capabilities',()=>{
  for(const permission of ['automatic-fullscreen','media','display-capture','clipboard-read','notifications','openExternal','geolocation','pointerLock','unknown'])assert.equal(allowLiveFullscreen(permission,desk,desk,details),false);
});
test('V107 fullscreen rejects child frames, workers, another window and untrusted documents',()=>{
  for(const request of [{},{isMainFrame:false,requestingUrl:details.requestingUrl},{isMainFrame:true},{isMainFrame:true,requestingUrl:'bcc://app/youtube.html'},{isMainFrame:true,requestingUrl:'https://example.com/live.html'},{isMainFrame:true,requestingUrl:'bcc://app/live.html?other'}])assert.equal(allowLiveFullscreen('fullscreen',desk,desk,request),false);
  assert.equal(allowLiveFullscreen('fullscreen',null,desk,details),false);
  assert.equal(allowLiveFullscreen('fullscreen',desk,null,details),false);
  assert.equal(allowLiveFullscreen('fullscreen',{...desk},desk,details),false);
});
test('V107 fullscreen rejects a destroyed or navigated desk',()=>{
  const gone={...desk,isDestroyed:()=>true},moved={...desk,getURL:()=> 'bcc://app/stream-management.html'};
  assert.equal(allowLiveFullscreen('fullscreen',gone,gone,details),false);
  assert.equal(allowLiveFullscreen('fullscreen',moved,moved,details),false);
});
