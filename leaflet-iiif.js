/*
 * Leaflet-IIIF 3.0.0
 * IIIF Viewer for Leaflet
 * by Jack Reed, @mejackreed
 */

function falseFn() {
  return false;
}
var emptyImageUrl =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

L.TileLayer.Iiif = L.GridLayer.extend({
  options: {
    continuousWorld: true,
    tileSize: 256,
    updateWhenIdle: true,
    tileFormat: 'jpg',
    fitBounds: true,
    setMaxBounds: false,
    rotate: 0,
  },

  initialize: function(url, options) {
    options = typeof options !== 'undefined' ? options : {};

    if (options.maxZoom) {
      this._customMaxZoom = true;
    }

    // Check for explicit tileSize set
    if (options.tileSize) {
      this._explicitTileSize = true;
    }

    // Check for an explicit quality
    if (options.quality) {
      this._explicitQuality = true;
    }

    options = L.setOptions(this, options);
    this._infoPromise = null;
    this._infoUrl = url;
    this._baseUrl = this._templateUrl();
    this._getInfo();

    this.on("tileunload", function (e) {
      e.tile.firstChild.onload = null;
    });
  },
  createTile: function (coords, done) {
    var _this = this,
      x = coords.x,
      y = coords.y,
      zoom = coords.z,
      scale = Math.pow(2, _this.maxNativeZoom - zoom),
      tileBaseSize = _this.options.tileSize * scale;
    if (this.options.rotate == 90) {
      var minx = y * tileBaseSize;
      var maxx = Math.min(minx + tileBaseSize, _this.x);
      var miny = Math.max(0, this.y - (x + 1) * tileBaseSize);
      var maxy = this.y - x * tileBaseSize;
    } else if (this.options.rotate == 180) {
      var minx = Math.max(0, this.x - (x + 1) * tileBaseSize);
      var maxx = this.x - x * tileBaseSize;
      var miny = Math.max(0, this.y - (y + 1) * tileBaseSize);
      var maxy = this.y - y * tileBaseSize;
    } else if (this.options.rotate == 270) {
      var minx = Math.max(0, this.x - (y + 1) * tileBaseSize);
      var maxx = this.x - y * tileBaseSize;
      var miny = x * tileBaseSize;
      var maxy = Math.min(miny + tileBaseSize, _this.y);
    } else {
      var minx = x * tileBaseSize;
      var miny = y * tileBaseSize;
      var maxx = Math.min(minx + tileBaseSize, _this.x);
      var maxy = Math.min(miny + tileBaseSize, _this.y);
    }

    var xDiff = (maxx - minx);
    var yDiff = (maxy - miny);

    // Canonical URI Syntax for v2
    var size = Math.ceil(xDiff / scale) + ',';
    if (_this.type === 'ImageService3') {
      // Cannonical URI Syntax for v3
      size = size + Math.ceil(yDiff / scale);
    }

    var tileUrl = L.Util.template(
      this._baseUrl,
      L.extend(
        {
          format: _this.options.tileFormat,
          quality: _this.quality,
          region: [minx, miny, xDiff, yDiff].join(","),
          rotation: 0,
          size: size,
        },
        this.options
      )
    );
    
    var tile = document.createElement("div");
    var img = document.createElement("img");
    tile.appendChild(img);
    img.alt = "";
    img.setAttribute("role", "presentation");
    img.style.transformOrigin = "top left";
    img.style.position = "absolute";
    img.style.left = 0;
    img.style.top = 0;
    if (this.options.rotate === 90)
      img.style.transform = "scale(1.001) rotate(90deg) translateY(-100%)";
    else if (this.options.rotate === 180)
      img.style.transform =
        "scale(1.001) rotate(180deg) translateY(-100%) translateX(-100%)";
    else if (this.options.rotate === 270)
      img.style.transform = "scale(1.001) rotate(270deg) translateX(-100%)";
    else img.style.transform = "scale(1.001)";

    img.onload = function () {
      done(null, tile);
    };
    img.onerror = function () {
      tile.innerHTML = "error";
      done(null, tile);
    };
    img.src = tileUrl;
    return tile;
  },
  _isVertical: function () {
    return this.options.rotate === 90 || this.options.rotate === 270;
  },
  _abortLoading: function () {
    var i, tile;
    for (i in this._tiles) {
      if (this._tiles[i].coords.z !== this._tileZoom) {
        tile = this._tiles[i].el;

        if (tile) {
          tile.firstChild.onload = falseFn;
          tile.firstChild.onerror = falseFn;

          if (!tile.firstChild.complete) {
            tile.firstChild.src = emptyImageUrl;
            tile.parentNode.removeChild(tile);
            delete this._tiles[i];
          }
        }
      }
    }
  },
  _removeTile: function (key) {
    var tile = this._tiles[key];
    if (!tile) {
      return;
    }
    tile.el.firstChild.src = emptyImageUrl;

    return L.GridLayer.prototype._removeTile.call(this, key);
  },
  _tileReady: function (coords, err, tile) {
    if (!this._map || (tile && tile.firstChild.src === emptyImageUrl)) {
      return;
    }
    return L.GridLayer.prototype._tileReady.call(this, coords, err, tile);
  },
  onAdd: function(map) {
    var _this = this;

    // Wait for info.json fetch and parse to complete
    Promise.all([_this._infoPromise]).then(function() {
      // Store unmutated imageSizes
      _this._imageSizesOriginal = _this._imageSizes.slice(0); 

      // Set maxZoom for map
      map._layersMaxZoom = _this.maxZoom;

      // Call add TileLayer
      L.TileLayer.prototype.onAdd.call(_this, map);

      // Set minZoom and minNativeZoom based on how the imageSizes match up
      var smallestImage = _this._imageSizes[0];
      var mapSize = _this._map.getSize();
      var newMinZoom = 0;
      // Loop back through 5 times to see if a better fit can be found.
      for (var i = 1; i <= 5; i++) {
        if (smallestImage.x > mapSize.x || smallestImage.y > mapSize.y) {
          smallestImage = smallestImage.divideBy(2);
          _this._imageSizes.unshift(smallestImage);
          newMinZoom = -i;
        } else {
          break;
        }
      }
      _this.options.minZoom = newMinZoom;
      _this.options.minNativeZoom = newMinZoom;
      _this._prev_map_layersMinZoom = _this._map._layersMinZoom;
      _this._map._layersMinZoom = newMinZoom;

      if (_this.options.fitBounds) {
        _this._fitBounds();
      }

      if(_this.options.setMaxBounds) {
        _this._setMaxBounds();
      }

      // Reset tile sizes to handle non 256x256 IIIF tiles
      _this.on('tileload', function(tile, url) {

        var height = tile.tile.naturalHeight,
          width = tile.tile.naturalWidth;

        // No need to resize if tile is 256 x 256
        if (height === 256 && width === 256) return;

        tile.tile.style.width = width + 'px';
        tile.tile.style.height = height + 'px';

      });
    })
    .catch(function(err){
        console.error(err);
    });
  },
  onRemove: function(map) {
    var _this = this;
    
    map._layersMinZoom = _this._prev_map_layersMinZoom;
    _this._imageSizes = _this._imageSizesOriginal;

    // Remove maxBounds set for this image
    if(_this.options.setMaxBounds) {
      map.setMaxBounds(null);
    }

    // Call remove TileLayer
    L.TileLayer.prototype.onRemove.call(_this, map);

  },
  _fitBounds: function() {
    var _this = this;

    // Find best zoom level and center map
    var initialZoom = _this._getInitialZoom(_this._map.getSize());
    var offset = _this._imageSizes.length - 1 - _this.options.maxNativeZoom;
    var imageSize = _this._imageSizes[initialZoom + offset];
    var sw = _this._map.options.crs.pointToLatLng(
      L.point(0, this._isVertical() ? imageSize.x : imageSize.y),
      initialZoom
    );
    var ne = _this._map.options.crs.pointToLatLng(
      L.point(this._isVertical() ? imageSize.y : imageSize.x, 0),
      initialZoom
    );
    var bounds = L.latLngBounds(sw, ne);

    _this._map.fitBounds(bounds, true);
  },
  _setMaxBounds: function() {
    var _this = this;

    // Find best zoom level, center map, and constrain viewer
    var initialZoom = _this._getInitialZoom(_this._map.getSize());
    var imageSize = _this._imageSizes[initialZoom];
    var sw = _this._map.options.crs.pointToLatLng(
      L.point(0, this._isVertical() ? imageSize.x : imageSize.y),
      initialZoom
    );
    var ne = _this._map.options.crs.pointToLatLng(
      L.point(this._isVertical() ? imageSize.y : imageSize.x, 0),
      initialZoom
    );
    var bounds = L.latLngBounds(sw, ne);

    _this._map.setMaxBounds(bounds, true);
  },
  _getInfo: function() {
    var _this = this;

    _this._infoPromise = fetch(_this._infoUrl)
      .then(function(response) {
        return response.json();
      })
      .catch(function(err){
          console.error(err);
      })
      .then(function(data) {
        _this.y = data.height;
        _this.x = data.width;

        var tierSizes = [],
          imageSizes = [],
          scale,
          width_,
          height_,
          tilesX_,
          tilesY_;

        // Set quality based off of IIIF version
        if (data.profile instanceof Array) {
          _this.profile = data.profile[0];
        }else {
          _this.profile = data.profile;
        }
        _this.type = data.type;

        _this._setQuality();

        // Unless an explicit tileSize is set, use a preferred tileSize
        if (!_this._explicitTileSize) {
          // Set the default first
          _this.options.tileSize = 256;
          if (data.tiles) {
            // Image API 2.0 Case
            _this.options.tileSize = data.tiles[0].width;
          } else if (data.tile_width){
            // Image API 1.1 Case
            _this.options.tileSize = data.tile_width;
          }
        }

        function ceilLog2(x) {
          return Math.ceil(Math.log(x) / Math.LN2);
        };

        // Calculates maximum native zoom for the layer
        _this.maxNativeZoom = Math.max(
          ceilLog2(_this.x / _this.options.tileSize),
          ceilLog2(_this.y / _this.options.tileSize),
          0
        );
        _this.options.maxNativeZoom = _this.maxNativeZoom;
        
        // Enable zooming further than native if maxZoom option supplied
        if (_this._customMaxZoom && _this.options.maxZoom > _this.maxNativeZoom) {
          _this.maxZoom = _this.options.maxZoom;
        }
        else {
          _this.maxZoom = _this.maxNativeZoom;
        }
        
        for (var i = 0; i <= _this.maxZoom; i++) {
          scale = Math.pow(2, _this.maxNativeZoom - i);
          width_ = Math.ceil(_this.x / scale);
          height_ = Math.ceil(_this.y / scale);
          tilesX_ = Math.ceil(width_ / _this.options.tileSize);
          tilesY_ = Math.ceil(height_ / _this.options.tileSize);
          tierSizes.push([tilesX_, tilesY_]);
          imageSizes.push(L.point(width_,height_));
        }

        _this._tierSizes = tierSizes;
        _this._imageSizes = imageSizes;
      })
      .catch(function(err){
          console.error(err);
      });
  },

  _setQuality: function() {
    var _this = this;
    var profileToCheck = _this.profile;

    if (_this._explicitQuality) {
      return;
    }

    // If profile is an object
    if (typeof(profileToCheck) === 'object') {
      profileToCheck = profileToCheck['@id'];
    }

    // Set the quality based on the IIIF compliance level
    switch (true) {
      case /^http:\/\/library.stanford.edu\/iiif\/image-api\/1.1\/compliance.html.*$/.test(profileToCheck):
        _this.options.quality = 'native';
        break;
      // Assume later profiles and set to default
      default:
        _this.options.quality = 'default';
        break;
    }
  },

  _infoToBaseUrl: function() {
    return this._infoUrl.replace('info.json', '');
  },
  _templateUrl: function() {
    return this._infoToBaseUrl() + '{region}/{size}/{rotation}/{quality}.{format}';
  },
  _isValidTile: function(coords) {
    var _this = this;
    var zoom = coords.z;
    var sizes = _this._tierSizes[zoom];
    var x = this._isVertical() ? coords.y : coords.x;
    var y = this._isVertical() ? coords.x : coords.y;
    if (zoom < 0 && x >= 0 && y >= 0) {
      return true;
    }

    if (!sizes) return false;
    if (x < 0 || sizes[0] <= x || y < 0 || sizes[1] <= y) {
      return false;
    }else {
      return true;
    }
  },
  _tileShouldBeLoaded: function(coords) {
    return this._isValidTile(coords);
  },
  _getInitialZoom: function (mapSize) {
    var _this = this;
    var tolerance = 0.8;
    var imageSize;
    // Calculate an offset between the zoom levels and the array accessors
    var offset = _this._imageSizes.length - 1 - _this.options.maxNativeZoom;
    for (var i = _this._imageSizes.length - 1; i >= 0; i--) {
      imageSize = _this._imageSizes[i];
      x = _this._isVertical() ? imageSize.y : imageSize.x;
      y = _this._isVertical() ? imageSize.x : imageSize.y;

      if (x * tolerance < mapSize.x && y * tolerance < mapSize.y) {
        return i - offset;
      }
    }
    // return a default zoom
    return 2;
  }
});

L.tileLayer.iiif = function(url, options) {
  return new L.TileLayer.Iiif(url, options);
};
