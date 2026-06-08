const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="directorial_segment_cards_wrapper"></div><div id="screenplay_segment_cards_wrapper"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.active_loaded_project_state_object = {
  scriptSegments: [{text: 'test', type: 'narrator', delivery: {pitch:'a', pacing:'b', volume:'c', style_label:'d'}, qwen_style: {vocal_texture: 'rough'}}],
  directorialSegments: [{text: 'test', type: 'narrator', delivery: {pitch:'a', pacing:'b', volume:'c', style_label:'d'}}]
};
const fs = require('fs');
const code = fs.readFileSync('./renderer/js/editor.js', 'utf8');
eval(code);
try {
  populate_screenplay_cards_in_editor_view();
  populate_directorial_cards_in_editor_view();
  console.log('SUCCESS');
} catch (e) {
  console.error(e);
}
