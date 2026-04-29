import '../../editor/src/styles/custom-properties/animations.css';
import '../../editor/src/styles/custom-properties/fonts.css';
import '../../editor/src/styles/custom-properties/colors.css';
import PopupLayer from '../../editor/src/views/popuplayer';
import Viewer from './src/views/viewer';

// Wait for jQuery and the DOM to be ready
$(document).ready(function() {
  console.log('[Viewer Frame] Document ready, initializing viewer...');
  
  try {
    // More robust React availability check
    let reactAvailable = false;
    let reactDOMAvailable = false;
    
    // Check multiple possible locations for React
    if (typeof React !== 'undefined') {
      reactAvailable = true;
      console.log('[Viewer Frame] React found in global scope');
    } else if (typeof window.React !== 'undefined') {
      window.React = window.React;
      React = window.React;
      reactAvailable = true;
      console.log('[Viewer Frame] React found at window.React');
    } else if (typeof require !== 'undefined') {
      try {
        window.React = require('react');
        React = window.React;
        reactAvailable = true;
        console.log('[Viewer Frame] React loaded via require');
      } catch (e) {
        console.log('[Viewer Frame] Could not require React:', e.message);
      }
    }
    
    // Check ReactDOM
    if (typeof ReactDOM !== 'undefined') {
      reactDOMAvailable = true;
      console.log('[Viewer Frame] ReactDOM found in global scope');
    } else if (typeof window.ReactDOM !== 'undefined') {
      window.ReactDOM = window.ReactDOM;
      ReactDOM = window.ReactDOM;
      reactDOMAvailable = true;
      console.log('[Viewer Frame] ReactDOM found at window.ReactDOM');
    } else if (typeof require !== 'undefined') {
      try {
        window.ReactDOM = require('react-dom');
        ReactDOM = window.ReactDOM;
        reactDOMAvailable = true;
        console.log('[Viewer Frame] ReactDOM loaded via require');
      } catch (e) {
        console.log('[Viewer Frame] Could not require ReactDOM:', e.message);
      }
    }
    
    if (!reactAvailable || !reactDOMAvailable) {
      const errorMsg = `React not available. React: ${reactAvailable}, ReactDOM: ${reactDOMAvailable}`;
      console.error('[Viewer Frame]', errorMsg);
      $('#app').html(`<div style="color: red; padding: 20px;">Error: ${errorMsg}<br>Check console for details.</div>`);
      return;
    }
    
    console.log('[Viewer Frame] React and ReactDOM available, creating viewer instance...');
    Viewer.instance = new Viewer();
    Viewer.instance.render();
    
    // Replace the Loading div instead of appending to body
    $('#app').empty().append(Viewer.instance.el);
    console.log('[Viewer Frame] Viewer instance rendered and inserted.');
    
  } catch (error) {
    console.error('[Viewer Frame] Error during initialization:', error);
    $('#app').html(`<div style="color: red; padding: 20px;">Error initializing viewer: ${error.message}<br><pre>${error.stack}</pre></div>`);
  }

  //add popup and dialog layers for the right click inspect menu to work
  PopupLayer.instance = new PopupLayer();
  document.body.appendChild(PopupLayer.instance.render().get(0));

  const dialogLayer = document.createElement('div');
  dialogLayer.classList.add('dialog-layer');
  $('body').append(dialogLayer);
});
