<template>
<div id="leaflet"></div>
</template>

<script>
import L from 'leaflet';
import Fullscreen from 'leaflet-fullscreen';
import Locate from 'leaflet.locatecontrol';
import { EventBus } from '../event-bus.js';
import 'leaflet.control.opacity/dist/L.Control.Opacity.js';

import 'leaflet/dist/leaflet.css';
import 'leaflet-fullscreen/dist/leaflet.fullscreen.css';
import 'leaflet.locatecontrol/dist/L.Control.Locate.min.css';
import 'leaflet.control.opacity/dist/L.Control.Opacity.css';
import 'font-awesome/css/font-awesome.min.css';

export default {

  name: 'leaflet',
  mounted: () => {
    const map = L.map('leaflet', {
      attributionControl: false,
      fullscreenControl: true,
      center: [40, 10],
      zoom: 3
    });

    const bm = L.tileLayer( 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: 'Background &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });

    bm.addTo(map);

    let layers = L.layerGroup().addTo(map);

    L.control.attribution({prefix: ''}).addTo(map);
    map.zoomControl.setPosition('topright');
    map.fullscreenControl.setPosition('topright');
    L.control.locate({position: 'topright'}).addTo(map);

    const Map_BaseLayer = {
      "": bm,
    };

    EventBus.$on('selected', selected => {
      layers.clearLayers();

      const hm = new L.tileLayer.wms(selected.links.wms, {
          layers: 'MapWarper',
          format: 'image/png',
          attribution: `<a href="https://commons.wikimedia.org/wiki/${selected.attributes.title}">Wikimedia Commons</a>`
        }
      );


      layers.addLayer( hm );

      const Map_AddLayer = {
        "": hm,
      };

      // remove previous opacity-control-widget
      document.querySelectorAll('.leaflet-control-layers').forEach(function(a){ a.remove() });

      //LayerControl
      L.control.layers(
        Map_BaseLayer,
        Map_AddLayer,
        {
          collapsed: false
        }
      ).addTo(map);

      //OpacityControl
      L.control.opacity(
          Map_AddLayer, {
          label: "opacity"
          }
      ).addTo(map);

      /*
      layers.addLayer(
        L.tileLayer.wms(selected.links.wms, {
          layers: 'MapWarper',
          format: 'image/png',
          attribution: `<a href="https://commons.wikimedia.org/wiki/${selected.attributes.title}">Wikimedia Commons</a>`
        })
      );
      */

      let bbox = selected.attributes.bbox.split(',');
      map.fitBounds([
        [bbox[3], bbox[2]],
        [bbox[1], bbox[0]]
      ]);

    });

    EventBus.$on('clearLayers', () => {
      layers.clearLayers();
    });

    EventBus.$on('getBounds', callback => {
      callback(map.getBounds());
    });

    EventBus.$on('toggleFullscreen', () => {
      map.toggleFullscreen();
    });

  }
}
</script>

<style scoped>
#leaflet {
    height: 100%;
    width: calc(100% - 400px);
    right: 0;
    position: absolute !important;
}

#leaflet:focus {
  border:none !important;
  outline:none !important;
}

/* Leaflet locate */
.fa.fa-map-marker,
.fa.fa-spinner.fa-spin {
    line-height: 30px;
}
</style>
