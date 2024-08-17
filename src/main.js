import "./style/style.css";
import { Map, View } from "ol";
import { getWidth, getTopLeft } from "ol/extent";
import TileLayer from "ol/layer/Tile";
import OSM from "ol/source/OSM";
import { XYZ, Vector } from "ol/source";
import { Draw, Modify, Snap } from "ol/interaction";
import VectorLayer from "ol/layer/Vector";
import { createStringXY } from "ol/coordinate";
import { defaults, ScaleLine, MousePosition } from "ol/control";
import { WMTS as GridWMTS } from "ol/tilegrid";
import WMTS, { optionsFromCapabilities } from "ol/source/WMTS";
import WMTSCapabilities from "ol/format/WMTSCapabilities";
import hjson from "hjson";
import { get as getProjection, Projection } from "ol/proj";

let draw = null;
let source = null;
let config = null;

const getConfig = async () => {
  const response = await fetch("./config.hjson");
  if (response.ok && response.status === 200) {
    const text = await response.text();
    const res = hjson.parse(text);
    config = res;
    initMap(res.baseLayer);
  }
};

getConfig();

const eventlistener = () => {
  const onMessage = (evt) => {
    if (evt.data) {
      let { type, value } = JSON.parse(evt.data);
      if (type === "initmap") {
        initMap(value);
      }
    }
  };
  window.addEventListener("message", onMessage);

  return () => {
    window.removeEventListener("message", onMessage);
  };
};

// eventlistener();

const initMap = async (baseLayer) => {
  let layer = null;
  switch (baseLayer.type) {
    case "XYZ":
      layer = new TileLayer({
        source: new XYZ({
          url: baseLayer.url,
          // url: "https://server.arcgisonline.com/ArcGIs/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        }),
      });
      break;
    case "WMTS":
      {
        let projection = getProjection("EPSG:4326");
        let extent = baseLayer.extent || [-180, -90, 180, 90];
        if (baseLayer.projection === "4490") {
          projection = new Projection({
            Code: "EPSG:4490",
            extent,
            units: "degrees",
          });
        } else if (baseLayer.projection === "3857") {
          projection = getProjection("EPSG:3857");
        }

        let resolutions = [];
        let matrixIds = [];
        let width = getWidth(extent);
        for (let z = 1; z < 19; z++) {
          resolutions[z] = width / (256 * Math.pow(2, z));
          matrixIds[z + (baseLayer.matrixIdOffest || 0)] = z;
        }
        let wmtsTileGrid = new GridWMTS({
          origin: getTopLeft(extent),
          resolutions: resolutions,
          matrixIds: matrixIds,
        });
        const options = {
          ...baseLayer.wmtsOption,
          url: baseLayer.url,
          projection: projection,
          tileGrid: wmtsTileGrid,
        };

        layer = new TileLayer({ source: new WMTS(options) });
      }
      break;
    default:
      layer = new TileLayer({ source: new OSM() });
  }

  source = new Vector();
  const style = {
    "fill-color": "rgba(255, 255, 255, 0.2)",
    "stroke-color": "#ffcc33",
    "stroke-width": 3,
    "circle-radius": 7,
    "circle-fill-color": "#ffcc33",
  };
  const map = new Map({
    target: "map",
    layers: [layer, new VectorLayer({ source, style })],
    view: new View({
      projection: "EPSG:4326",
      center: [119, 23],
      zoom: 4.5,
    }),
    controls: defaults().extend([
      new ScaleLine(),
      new MousePosition({
        coordinateFormat: createStringXY(4),
        projection: "EPSG:4326",
        className: "custom-mouse-position",
      }),
    ]),
  });

  window.map = map;
  initModify();
  initDraw(getDrawType());
};

const initModify = () => {
  let modify = new Modify({ source: source });
  map.addInteraction(new Snap({ source: source }));
  map.addInteraction(modify);
  modify.on("modifyend", (evt) => {
    console.log(evt);
    evt.features.item(0) && setValue(evt.features.item(0));
  });
};

const initDraw = (type) => {
  exitDraw();
  draw = new Draw({
    source: source,
    type,
  });
  map.addInteraction(draw);
  draw.on("drawstart", () => {
    source?.clear();
  });
  draw.on("drawend", (evt) => {
    console.log(evt);
    evt.feature && setValue(evt.feature);
  });
};

const exitDraw = () => {
  draw && map.removeInteraction(draw) && (draw = null);
};

const setValue = (feature) => {
  let modal = document.querySelector("#dialog");
  modal.show();
  let content = modal.querySelector("#content");
  let coords = feature.getGeometry().getCoordinates();

  switch (getDrawType()) {
    case "Point":
      {
        content.innerHTML = `
          <span class="flex w-full items-center justify-evenly mb-5">
            经度:
            <input type="text" placeholder="经度" value=${coords[0]}
              class="input input-bordered w-full max-w-xs" />
          </span>
          <span class="flex w-full items-center justify-evenly">
            纬度:
            <input type="text" placeholder="纬度" value=${coords[1]}
              class="input input-bordered w-full max-w-xs" />
          </span>`;
      }
      break;
    case "LineString":
    case "Polygon":
      {
        content.innerHTML = `
          <span class="flex w-full justify-evenly">
            坐标：
            <textarea class="textarea textarea-bordered w-5/6" rows="4" 
              placeholder="坐标">${JSON.stringify(coords)}</textarea>
          </span>`;
      }
      break;
    default:
  }
};
const getValue = () => {
  let content = document.querySelector("#content");
  let res = {};
  switch (getDrawType()) {
    case "Point":
      {
        let inputs = content.querySelectorAll("input");
        res = {
          lon: inputs[0].value,
          lat: inputs[1].value,
        };
      }
      break;
    case "LineString":
    case "Polygon":
      {
        let textarea = content.querySelector("textarea");
        res = textarea.value;
      }
      break;
    default:
  }

  return res;
};

const getDrawType = () => {
  let type = "Point"; // LineString  Point   Polygon
  let search = window.location.search;
  if (search) {
    type = getQueryParam("type");
  }
  return type;
};

const getQueryParam = (key) => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(key);
};

window.submit = () => {
  document.querySelector("#dialog").close();
  const params = { type: "pickresult", value: getValue() };
  window.parent.postMessage(JSON.stringify(params), "*");
};

// initMap();
