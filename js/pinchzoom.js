/*!
 * PinchZoom Minimal (no iScroll) v1.0.0
 * - Two-finger pinch only; one-finger swipes scroll the page (OliveYoung-like UX)
 * - Hard clamp to avoid white gaps
 * - Double-tap zoom toggle
 * - Works with PointerEvents; falls back to TouchEvents if needed
 */
(function (global) {
    'use strict';
  
    var defaults = {
      maxScale: 4,
      minScale: 1,
      doubleTapScale: 2,
      doubleTapThreshold: 260, // ms
      doubleTapMove: 16        // px
    };
  
    function clamp(n, min, max){ return n < min ? min : (n > max ? max : n); }
  
    function PinchInstance(root, opts){
      this.root   = root;
      this.target = root.querySelector('.zoom-target') || root.firstElementChild;
      if (!this.target) throw new Error('[PinchZoom] .zoom-target not found');
  
      this.img = this.target.querySelector('img') || this.target.firstElementChild;
  
      this.opts  = Object.assign({}, defaults, opts || {});
      this.scale = 1;
      this.tx = 0; this.ty = 0;
      this._pointers = new Map();
      this._start = null;
      this._lastTap = {t:0,x:0,y:0};
  
      this._bind();
      if (this.img && !this.img.complete) {
        this.img.addEventListener('load', this._apply.bind(this), {once:true});
      } else {
        this._apply();
      }
    }
  
    PinchInstance.prototype._apply = function(){
      this.target.style.transform = 'translate3d('+this.tx+'px,'+this.ty+'px,0) scale('+this.scale+')';
    };
  
    PinchInstance.prototype._sizes = function(){
      var cw = this.root.clientWidth,
          ch = this.root.clientHeight || (this.root.getBoundingClientRect().height|0) || window.innerHeight;
  
      var iw = cw, ih = iw; // default square fallback
      if (this.img && this.img.naturalWidth && this.img.naturalHeight) {
        iw = cw;
        ih = Math.round(this.img.naturalHeight * (cw / this.img.naturalWidth));
      } else {
        // try measured
        var r = this.target.getBoundingClientRect();
        if (r.width && r.height) { iw = r.width; ih = r.height; }
      }
      return {cw:cw, ch:ch, iw:iw, ih:ih};
    };
  
    PinchInstance.prototype._clampTranslate = function(ntx, nty){
      var m = this._sizes();
      var W = m.iw * this.scale, H = m.ih * this.scale;
  
      var minX = Math.min(0, m.cw - W), maxX = 0;
      var minY = Math.min(0, m.ch - H), maxY = 0;
  
      return {
        x: clamp(ntx, minX, maxX),
        y: clamp(nty, minY, maxY)
      };
    };
  
    PinchInstance.prototype._localAt = function(clientX, clientY){
      var rect = this.target.getBoundingClientRect();
      return {
        x: (clientX - rect.left - this.tx) / this.scale,
        y: (clientY - rect.top  - this.ty) / this.scale
      };
    };
  
    PinchInstance.prototype._pinchTo = function(newScale, cx, cy){
      var s = clamp(newScale, this.opts.minScale, this.opts.maxScale);
      var p = this._localAt(cx, cy);
  
      // keep finger-under point anchored
      var rect = this.target.getBoundingClientRect();
      var ntx = cx - p.x * s - rect.left;
      var nty = cy - p.y * s - rect.top;
  
      this.scale = s;
      var c = this._clampTranslate(ntx, nty);
      this.tx = c.x; this.ty = c.y;
      this._apply();
    };
  
    /* ========= PointerEvents (preferred) ========= */
    PinchInstance.prototype._onPointerDown = function(e){
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      this._pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
      this.target.setPointerCapture && this.target.setPointerCapture(e.pointerId);
  
      // one finger: do nothing; let page scroll naturally
      if (this._pointers.size === 2){
        e.preventDefault();
        var arr = Array.from(this._pointers.values());
        this._start = {
          s: this.scale, tx:this.tx, ty:this.ty,
          p1: arr[0], p2: arr[1]
        };
      }
    };
  
    PinchInstance.prototype._onPointerMove = function(e){
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  
      if (this._pointers.size === 2 && this._start){
        e.preventDefault();
        var arr = Array.from(this._pointers.values());
        var p1 = arr[0], p2 = arr[1];
  
        var dx0 = this._start.p2.x - this._start.p1.x;
        var dy0 = this._start.p2.y - this._start.p1.y;
        var d0  = Math.hypot(dx0, dy0) || 1;
  
        var dx1 = p2.x - p1.x;
        var dy1 = p2.y - p1.y;
        var d1  = Math.hypot(dx1, dy1) || d0;
  
        var pinchScale = this._start.s * (d1 / d0);
        var cx = (p1.x + p2.x)/2, cy = (p1.y + p2.y)/2;
  
        this._pinchTo(pinchScale, cx, cy);
      }
    };
  
    PinchInstance.prototype._onPointerUpCancel = function(e){
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      this._pointers.delete(e.pointerId);
      this.target.releasePointerCapture && this.target.releasePointerCapture(e.pointerId);
      if (this._pointers.size < 2) this._start = null;
  
      if (this.scale <= 1.0001){
        this.scale = 1; this.tx = 0; this.ty = 0;
        this._apply();
      } else {
        var c = this._clampTranslate(this.tx, this.ty);
        this.tx = c.x; this.ty = c.y; this._apply();
      }
    };
  
    /* ========= TouchEvents fallback (older Safari) ========= */
    PinchInstance.prototype._onTouchMove = function(ev){
      if (!ev.touches || ev.touches.length !== 2) return;
      ev.preventDefault(); // only when 2 fingers
      var t0 = ev.touches[0], t1 = ev.touches[1];
  
      if (!this._start){
        this._start = {
          s: this.scale,
          d: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1,
          cx: (t0.clientX + t1.clientX)/2,
          cy: (t0.clientY + t1.clientY)/2
        };
        return;
      }
  
      var d1 = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || this._start.d;
      var pinchScale = this._start.s * (d1 / this._start.d);
      var cx = (t0.clientX + t1.clientX)/2, cy = (t0.clientY + t1.clientY)/2;
  
      this._pinchTo(pinchScale, cx, cy);
    };
    PinchInstance.prototype._onTouchEndCancel = function(){
      this._start = null;
      if (this.scale <= 1.0001){
        this.scale = 1; this.tx = 0; this.ty = 0; this._apply();
      } else {
        var c = this._clampTranslate(this.tx, this.ty);
        this.tx = c.x; this.ty = c.y; this._apply();
      }
    };
  
    /* ========= Double-tap zoom ========= */
    PinchInstance.prototype._bindDoubleTap = function(){
      var self = this;
      self.root.addEventListener('touchend', function(ev){
        if (ev.touches && ev.touches.length) return;
        var t = ev.changedTouches ? ev.changedTouches[0] : ev;
        var now = performance.now();
        var isDT = (now - self._lastTap.t) < self.opts.doubleTapThreshold &&
                   Math.hypot(t.clientX - self._lastTap.x, t.clientY - self._lastTap.y) < self.opts.doubleTapMove;
        self._lastTap.t = now; self._lastTap.x = t.clientX; self._lastTap.y = t.clientY;
        if (!isDT) return;
  
        ev.preventDefault();
        if (self.scale <= 1.01) self._pinchTo(self.opts.doubleTapScale, t.clientX, t.clientY);
        else { self.scale = 1; self.tx = 0; self.ty = 0; self._apply(); }
      }, {passive:false});
    };
  
    PinchInstance.prototype._bind = function(){
      var self = this;
  
      if (window.PointerEvent){
        self.root.addEventListener('pointerdown', self._onPointerDown.bind(self), {passive:true});
        self.root.addEventListener('pointermove',  self._onPointerMove.bind(self), {passive:false});
        self.root.addEventListener('pointerup',    self._onPointerUpCancel.bind(self), {passive:true});
        self.root.addEventListener('pointercancel',self._onPointerUpCancel.bind(self), {passive:true});
        self.root.addEventListener('pointerleave', self._onPointerUpCancel.bind(self), {passive:true});
      } else {
        // Touch fallback only for pinch (2 fingers). One finger stays passive → page scroll.
        self.root.addEventListener('touchmove', self._onTouchMove.bind(self), {passive:false});
        self.root.addEventListener('touchend',  self._onTouchEndCancel.bind(self), {passive:true});
        self.root.addEventListener('touchcancel', self._onTouchEndCancel.bind(self), {passive:true});
      }
  
      self._bindDoubleTap();
    };
  
    /* ========= Public API ========= */
    function attach(selectorOrElements, opts){
      var nodes = (typeof selectorOrElements === 'string')
        ? document.querySelectorAll(selectorOrElements)
        : (selectorOrElements.length ? selectorOrElements : [selectorOrElements]);
  
      var list = [];
      nodes.forEach(function(node){
        // ensure structure: .zoom-container > .zoom-target > img
        var target = node.querySelector('.zoom-target');
        if (!target){
          var wrap = document.createElement('div');
          wrap.className = 'zoom-target';
          while (node.firstChild) wrap.appendChild(node.firstChild);
          node.appendChild(wrap);
        }
        list.push(new PinchInstance(node, opts));
      });
      return list;
    }
  
    global.PinchZoom = { attach: attach };
  })(this);
  