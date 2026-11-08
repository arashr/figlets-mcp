'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '../../packages/figma-bridge-plugin/code.js'), 'utf8');
let serial = 0;
function makeRuntime(unavailable) {
  const loaded = new Set(); const attempts = [];
  const styles = [{ id: 'body', name: 'type/body/md', fontName: { family: 'Inconsolata', style: 'Regular' }, fontSize: 16, lineHeight: { unit: 'PIXELS', value: 24 }, letterSpacing: { unit: 'PIXELS', value: 0 } }];
  function node(type) {
    let font = { family: 'Inter', style: 'Regular' }, styleId = '', characters = '';
    const n = { id: String(++serial), type, name: type, children: [], x: 0, y: 0, width: 120, height: 44, fills: [], strokes: [], effects: [], boundVariables: {}, visible: true, opacity: 1,
      appendChild(child) { child.remove(); this.children.push(child); child.parent = this; },
      remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
      resize(w,h) { this.width=w; this.height=h; }, resizeWithoutConstraints(w,h) { this.resize(w,h); },
      findAll(predicate) { return this.children.flatMap(child => [...(predicate(child) ? [child] : []), ...child.findAll(predicate)]); },
      findOne(predicate) { return this.findAll(predicate)[0] || null; },
      setBoundVariable(property,v) { this.boundVariables[property] = { type: 'VARIABLE_ALIAS', id:v.id }; },
      setExplicitVariableModeForCollection() {}, rescale() {},
      createInstance() { return node('INSTANCE'); },
      clone() { return node(type); },
      getPluginData() { return ''; }, setPluginData() {},
    };
    Object.defineProperty(n, 'fontName', { get() { return font; }, set(value) { if (!loaded.has(JSON.stringify(value))) throw new Error('Unloaded font: '+value.family+' '+value.style); font=value; styleId=''; } });
    Object.defineProperty(n, 'characters', { get() { return characters; }, set(value) { if (!loaded.has(JSON.stringify(font))) throw new Error('Characters require loaded '+font.family); characters=value; } });
    Object.defineProperty(n, 'textStyleId', { get() { return styleId; }, set(value) { const style=styles.find(s=>s.id===value); if(style) { n.fontName=style.fontName; styleId=value; } } });
    return n;
  }
  const page=node('PAGE'); page.selection=[];
  const component=node('COMPONENT'); component.name='Font test'; component.description='Existing purpose'; component.componentPropertyDefinitions={}; page.appendChild(component); page.selection=[component];
  const figma={ root: { name:'Disposable', getPluginData(){ return ''; }, setPluginData(){} }, currentPage:page, mixed:Symbol('mixed'), ui:{ onmessage:null, postMessage(){} }, showUI(){}, on(){}, viewport:{scrollAndZoomIntoView(){}},
    getNodeByIdAsync:async id=>id===component.id?component:null,
    getLocalTextStylesAsync:async()=>styles, getLocalEffectStylesAsync:async()=>[], getLocalPaintStylesAsync:async()=>[],
    variables:{getLocalVariablesAsync:async()=>[],getLocalVariableCollectionsAsync:async()=>[],getVariableByIdAsync:async()=>null},
    loadFontAsync:async font=>{ attempts.push(JSON.stringify(font)); if(unavailable(font)) throw new Error('Cannot load '+font.family+' '+font.style); loaded.add(JSON.stringify(font)); },
    listAvailableFontsAsync:async()=>[{fontName:{family:'Last Available',style:'Book'}}],
  };
  for(const [method,type] of Object.entries({createText:'TEXT',createFrame:'FRAME',createSection:'SECTION',createRectangle:'RECTANGLE',createEllipse:'ELLIPSE'})) figma[method]=()=>{const n=node(type);page.appendChild(n);return n;};
  const context=vm.createContext({figma,__html__:'',console,setTimeout,clearTimeout});
  vm.runInContext(code,context);
  return {context,figma,component,styles,attempts,page,loaded};
}
module.exports=(async()=>{
  let referenceMarkdown;
  for (const unavailable of [()=>false, font=>font.family==='Inconsolata', font=>font.family==='Inconsolata' && font.style==='Regular', font=>font.family==='Inter', font=>font.family!=='Last Available']) {
    const runtime=makeRuntime(unavailable);
    const original=JSON.stringify(runtime.styles);
    const result=await runtime.context._buildComponentDoc({componentId:runtime.component.id,componentName:'Font test',description:'Purpose',usageDo:['Use it','Keep it'],usageDont:['Avoid misuse','Avoid clutter']});
    assert.ok(!result.error, result.error);
    assert.strictEqual(result.specSheet.status,'complete',result.specSheet.error);
    assert.ok(result.markdown.includes('# Font test'));
    // IDs differ between fixtures; compare the complete handoff after normalizing identity only.
    const comparable = result.markdown.replace(/ComponentSet ID:\*\* \d+/g, 'ComponentSet ID:** source');
    if (!referenceMarkdown) referenceMarkdown = comparable;
    else assert.strictEqual(comparable,referenceMarkdown,'font fallback must not change documented facts');
    assert.strictEqual(JSON.stringify(runtime.styles),original,'source styles must remain unchanged');
    assert.ok(runtime.component.description.includes('[SPEC]'));
    assert.ok(runtime.attempts.filter(font=>font===JSON.stringify({family:'Inconsolata',style:'Regular'})).length<=1,'failed exact font should not be retried');
    if(unavailable({family:'Inconsolata',style:'Regular'})) assert.ok(result.specSheet.fontFallbacks.some(item=>item.requested.family==='Inconsolata'));
  }
  const exhausted=makeRuntime(()=>true);
  const result=await exhausted.context._buildComponentDoc({componentId:exhausted.component.id,componentName:'Font test',description:'Purpose',usageDo:['Use it','Keep it'],usageDont:['Avoid misuse','Avoid clutter']});
  assert.strictEqual(result.specSheet.status,'failed');
  assert.strictEqual(result.specSheet.retryable,false);
  assert.ok(result.markdown.includes('# Font test'),'Markdown survives visual font exhaustion');
  assert.ok(exhausted.component.description.includes('[SPEC]'));
  let failFonts = false;
  const repeat = makeRuntime(()=>failFonts);
  const args={componentId:repeat.component.id,componentName:'Font test',description:'Purpose',usageDo:['Use it','Keep it'],usageDont:['Avoid misuse','Avoid clutter']};
  const first=await repeat.context._buildComponentDoc(args);
  assert.strictEqual(first.specSheet.status,'complete');
  const sheet=repeat.page.findOne(n=>n.name==='Font test · Spec');
  assert.ok(sheet);
  failFonts=true;
  const failed=await repeat.context._buildComponentDoc(args);
  assert.strictEqual(failed.specSheet.status,'failed');
  assert.strictEqual(repeat.page.findOne(n=>n.name==='Font test · Spec'),sheet,'failed replacement preserves previous sheet');
  assert.strictEqual(failed.markdown,first.markdown,'render failure does not prevent or alter handoff generation');
})();
