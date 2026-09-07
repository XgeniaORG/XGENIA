// Controls
import Button from './nodes/controls/button.ts';
import CheckBox from './nodes/controls/checkbox.ts';
import Options from './nodes/controls/options.ts';
import RadioButton from './nodes/controls/radiobutton.ts';
import RadioButtonGroup from './nodes/controls/radiobuttongroup.ts';
import Range from './nodes/controls/slider.ts';
import Sound from './nodes/controls/sound.ts';
import TextInput from './nodes/controls/text-input.ts';
import NavigationStack from './nodes/navigation/navigation-stack.jsx';
import Page from './nodes/navigation/page.js';
import Router from './nodes/navigation/router.tsx';
import ExternalLink from './nodes/std-library/externallink';
// import AnimationNode from './nodes/std-library/animation';
import AnimationTargetNode from './nodes/std-library/animation-target';
import GsapAnimatorNode from './nodes/std-library/gsap-animator';
import Circle from './nodes/visual/circle.js';
import Columns from './nodes/visual/columns.js';
import CSSDefinition from './nodes/visual/css-definition';
import DragNode from './nodes/visual/drag.js';
import Group from './nodes/visual/group.js';
import Icon from './nodes/visual/icon.js';
import Image from './nodes/visual/image.js';
import LineChart from './nodes/visual/line-chart.js';
import DistributionChart from './nodes/visual/distribution-chart.js';
import HistogramChart from './nodes/visual/histogram-chart.js';
import ReelVisualizer from './nodes/visual/reel-visualizer.js';
import DebugPanelVisual from './nodes/visual/debug-panel-visual.js';
import DictViewer from './nodes/visual/dict-viewer.js';
import ProjectVersionTag from './nodes/visual/project-version-tag.js';
import TextNode from './nodes/visual/text.js';
import Video from './nodes/visual/video.js';
import LoaderNode from './nodes/visual/loader.js';
import './assets/style.css';
//Deprecated
import ButtonOld from './nodes-deprecated/controls/button.jsx';
import CheckBoxOld from './nodes-deprecated/controls/checkbox.jsx';
import FieldSet from './nodes-deprecated/controls/fieldset.jsx';
import Form from './nodes-deprecated/controls/form.jsx';
import Label from './nodes-deprecated/controls/label.jsx';
import OptionsOld from './nodes-deprecated/controls/options.jsx';
import RadioButtonOld from './nodes-deprecated/controls/radiobutton.jsx';
import RangeOld from './nodes-deprecated/controls/range.jsx';
import TextInputOld from './nodes-deprecated/controls/text-input.jsx';

// Game Nodes 
import InputActionNode from './nodes/std-library/InputAction';


// Game nodes already imported above

import * as foreachModule from './nodes/std-library/data/foreach.jsx';
import * as forloopModule from './nodes/std-library/data/forloop.jsx';

export default function registerNodes(xgeniaRuntime) {
  [
    // require('./nodes/std-library/counter'), // moved to runtime
    //  require('./nodes/std-library/expression'), // moved to runtime
    //require('./nodes/std-library/condition'),
    //require('./nodes/std-library/and'),
    //require('./nodes/std-library/or'),
    require('./nodes/std-library/switch'),
    //require('./nodes/std-library/booleantostring'), // moved to runtime
    //require('./nodes/std-library/datetostring'),
    //require('./nodes/std-library/stringmapper'),
    //require('./nodes/std-library/inverter'),
    require('./nodes/std-library/timer'),
    require('./nodes/std-library/variables/color'),
    //require('./nodes/std-library/substring'), // moved to runtime
    require('./nodes/std-library/eventsender'),
    require('./nodes/std-library/eventreceiver'),
    require('./nodes/std-library/screenresolution'),
    require('./nodes/std-library/timestamp'),
    require('./nodes/std-library/javascript'),
    //require('./nodes/std-library/simplejavascript'), // moved to runtime
    require('./nodes/std-library/numberremapper'),
    require('./nodes/std-library/valuechanged'),
    require('./nodes/std-library/states'),
    //require('./nodes/std-library/stringformat'), // moved to runtime
    // Use the imported foreachModule (includes setup function)
    foreachModule,
    // Repeater Loop - like For Each, but incrementally adds items without rebuilding existing ones
    forloopModule,
    require('./nodes/std-library/data/foreachactions'),
    require('./nodes/std-library/colorblend'),
    require('./nodes/std-library/animate-to-value'),

    //require('./nodes/std-library/variables/number'), // moved to runtime
    //require('./nodes/std-library/variables/string'),
    //require('./nodes/std-library/variables/boolean'),
    require('./nodes/std-library/variables/color'),

    // Component Object
    require('./nodes/std-library/componentutils/componentobject'),
    require('./nodes/std-library/componentutils/parentcomponentobject'),
    require('./nodes/std-library/componentutils/setcomponentobjectproperties'),
    require('./nodes/std-library/componentutils/setparentcomponentobjectproperties'),

    // Variable
    require('./nodes/std-library/data/variablenode2'),
    require('./nodes/std-library/data/setvariablenode'),
    require('./nodes/std-library/data/showvaluenode'),

    // New object
    // require('./nodes/std-library/data/modelnode2'), // moved to runtime
    // require('./nodes/std-library/data/setmodelpropertiesnode'),
    // require('./nodes/std-library/data/newmodelnode'),

    // New record
    //require('./nodes/std-library/data/dbmodelnode2'), // moved to runtime
    //require('./nodes/std-library/data/dbcollectionnode2'), // moved to runtime
    // require('./nodes/std-library/data/setdbmodelpropertiesnode'),
    // require('./nodes/std-library/data/deletedbmodelpropertiesnode'),
    // require('./nodes/std-library/data/newdbmodelpropertiesnode'),
    // require('./nodes/std-library/data/dbmodelnode-addrelation'),
    // require('./nodes/std-library/data/dbmodelnode-removerelation'),
    // require('./nodes/std-library/data/filterdbmodelsnode'),

    // New array
    require('./nodes/std-library/data/collectionnode2'),
    require('./nodes/std-library/data/collectionnode-insert'),
    require('./nodes/std-library/data/collectionnode-remove'),
    require('./nodes/std-library/data/collectionnode-clear'),
    require('./nodes/std-library/data/collectionnode-new'),
    require('./nodes/std-library/data/filtercollectionnode'),

    require('./nodes/std-library/data/staticdata'),

    require('./nodes/std-library/data/mapcollectionnode'),
    require('./nodes/std-library/data/sortcollectionnode'),
    require('./nodes/std-library/data/fillarraynode'),
    require('./nodes/std-library/data/concatenatearraynode'),
    require('./nodes/std-library/data/copyarraynode'),
    require('./nodes/std-library/data/extractvaluesnode'),
    require('./nodes/std-library/data/getarrayitemnode'),
    require('./nodes/std-library/data/iteratornode'),
    require('./nodes/std-library/data/modifyobjectinarraynode'),
    //require('./nodes/std-library/data/restnode'), // moved to runtime
    require('./nodes/std-library/data/cloudfunction2'),
    //require('./nodes/std-library/uniqueid'), // moved to runtime

    // Files
    require('./nodes/std-library/openfilepicker'),
    require('./nodes/std-library/uploadfile'),
    //require('./nodes/std-library/data/cloudfilenode'), // moved to runtime

    // Navigation
    require('./nodes/navigation/navigate-back'),
    require('./nodes/navigation/navigate-to-path'),
    require('./nodes/navigation/navigate'),
    require('./nodes/navigation/showpopup'),
    require('./nodes/navigation/closepopup'),

    require('./nodes/navigation/page-inputs'),
    require('./nodes/navigation/router-navigate'),

    // User
    require('./nodes/std-library/user/login'),
    require('./nodes/std-library/user/logout'),
    require('./nodes/std-library/user/signup'),
    //require('./nodes/std-library/user/user'), // moved to runtime
    //require('./nodes/std-library/user/setuserproperties'), // moved to runtime
    require('./nodes/std-library/user/verifyemail'),
    require('./nodes/std-library/user/sendemailverification'),
    require('./nodes/std-library/user/resetpassword'),
    require('./nodes/std-library/user/requestpasswordreset'),

    // Deprecated
    require('./nodes/std-library/data/cloudfunction'),
    require('./nodes-deprecated/std-library/componentstate'),
    require('./nodes-deprecated/std-library/parentcomponentstate'),
    require('./nodes-deprecated/std-library/data/modelnode'),
    require('./nodes-deprecated/std-library/data/variablenode'),
    require('./nodes-deprecated/std-library/gyroscope'),
    require('./nodes-deprecated/std-library/globals'),
    require('./nodes-deprecated/std-library/signaltoindex'),
    require('./nodes-deprecated/std-library/numberblend'),
    require('./nodes-deprecated/std-library/stringselector'),
    // require('./nodes-deprecated/std-library/animation'), // REMOVED: Conflicts with new Animation node
    require('./nodes-deprecated/std-library/transition'),
    require('./nodes-deprecated/std-library/data/dbmodelnode'),
    require('./nodes-deprecated/std-library/data/dbcollectionnode'),
    require('./nodes-deprecated/std-library/data/collectionnode'),
    require('./nodes-deprecated/std-library/scriptdownloader'),


  ].forEach(function (nodeDefinition) {
    xgeniaRuntime.registerNode(nodeDefinition);
  });

  // Register Pixi nodes
  // Moved to Proprietary Module

  // Keep Input Action
  xgeniaRuntime.registerNode(InputActionNode);

  // Game Nodes
  // xgeniaRuntime.registerNode(GameTemplateNode);
  // xgeniaRuntime.registerNode(GameBehaviorNode);
  // xgeniaRuntime.registerNode(GameObjectNode);
  // xgeniaRuntime.registerNode(GameRoomNode);
  // xgeniaRuntime.registerNode(GameSpriteNode);

  xgeniaRuntime.registerNode(CSSDefinition);
  xgeniaRuntime.registerNode(Group);
  xgeniaRuntime.registerNode(TextNode);
  xgeniaRuntime.registerNode(Image);
  xgeniaRuntime.registerNode(Icon);
  xgeniaRuntime.registerNode(Circle);
  xgeniaRuntime.registerNode(Video);
  xgeniaRuntime.registerNode(LoaderNode);
  xgeniaRuntime.registerNode(DragNode);
  xgeniaRuntime.registerNode(ExternalLink);
  // xgeniaRuntime.registerNode(AnimationNode);
  xgeniaRuntime.registerNode(AnimationTargetNode);
  xgeniaRuntime.registerNode(GsapAnimatorNode);
  xgeniaRuntime.registerNode(Columns);

  // Custom UI Elements
  xgeniaRuntime.registerNode(LineChart);
  xgeniaRuntime.registerNode(DistributionChart);
  xgeniaRuntime.registerNode(HistogramChart);
  xgeniaRuntime.registerNode(ReelVisualizer);
  xgeniaRuntime.registerNode(DebugPanelVisual);
  xgeniaRuntime.registerNode(DictViewer);
  xgeniaRuntime.registerNode(ProjectVersionTag);

  // Deprecated UI Controls
  xgeniaRuntime.registerNode(ButtonOld);
  xgeniaRuntime.registerNode(CheckBoxOld);
  xgeniaRuntime.registerNode(RadioButtonOld);
  xgeniaRuntime.registerNode(OptionsOld);
  xgeniaRuntime.registerNode(RangeOld);
  xgeniaRuntime.registerNode(Label);
  xgeniaRuntime.registerNode(TextInputOld);
  xgeniaRuntime.registerNode(Form);
  xgeniaRuntime.registerNode(FieldSet);

  // UI Controls
  xgeniaRuntime.registerNode(Button);
  xgeniaRuntime.registerNode(CheckBox);
  xgeniaRuntime.registerNode(RadioButtonGroup);
  xgeniaRuntime.registerNode(RadioButton);
  xgeniaRuntime.registerNode(Options);
  xgeniaRuntime.registerNode(Range);
  xgeniaRuntime.registerNode(TextInput);
  xgeniaRuntime.registerNode(Sound);

  // Navigation
  xgeniaRuntime.registerNode(NavigationStack);
  xgeniaRuntime.registerNode(Page);
  xgeniaRuntime.registerNode(Router);
}
