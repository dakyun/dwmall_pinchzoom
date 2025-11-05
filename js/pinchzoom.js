/**
 * PinchZoom (iScrollZoom 기반) — viewport/실측 높이 보정 최종판
 * - baseH = 실제 렌더 높이(1x) 실측 후 캐싱 → scrollerHeight = baseH * scale
 * - refresh()/zoom 중 경계 모두 baseH 기준으로 일관 계산
 * - viewport = visualViewport.height(없으면 innerHeight)
 * - _zoomEnd 점프 제거, 더블탭 지원
 *
 * 외부 의존: iscroll-zoom.js (v5.x)
 */
(function($){
    $(function(){
      if (typeof IScrollZoom === 'undefined') {
        console.error('[PinchZoom] IScrollZoom not found. Include iscroll-zoom.js first.');
        return;
      }
  
      var UA = navigator.userAgent||'';
      var IS_ANDROID = /Android/i.test(UA);
  
      /* ───── 옵션 브릿지 ───── */
      function tellNative(zooming){
        try { window.AndroidZoomBridge && AndroidZoomBridge.setZooming(zooming); } catch(e){}
      }
  
      /* ───── 공통 유틸 ───── */
      function viewportHeight(){
        return (window.visualViewport && window.visualViewport.height)
          ? Math.round(window.visualViewport.height)
          : window.innerHeight;
      }
      function measureBaseSize(root, scroller){
        // 1x 상태에서 실제 렌더 높이/너비 실측 (transform 영향 없음)
        // 이미지가 박스 안에 있더라도 "scroller의 첫 번째 실제 콘텐츠" 기준으로 측정
        var content = scroller.firstElementChild || scroller;
        // 강제로 레이아웃 확정
        var rect = content.getBoundingClientRect();
        var baseW = Math.max(1, Math.round(rect.width));
        var baseH = Math.max(1, Math.round(rect.height));
        return { baseW, baseH };
      }
  
      /* ───── refresh() 패치: viewport/baseH 기준 경계 재산출 ───── */
      (function patchRefresh(){
        var _orig = IScrollZoom.prototype.refresh;
        IScrollZoom.prototype.refresh = function(){
          _orig.call(this);
  
          // viewport 보정
          this.wrapperHeight = Math.min(this.wrapper.clientHeight, viewportHeight());
          this.wrapperWidth  = this.wrapper.clientWidth;
  
          // baseH 없으면(초기) 한 번 측정
          if (!this._baseH || !this._baseW) {
            var m = measureBaseSize(this.wrapper, this.scroller);
            this._baseW = m.baseW;
            this._baseH = m.baseH;
          }
  
          // 경계 일관 계산 (여유 1px)
          var EPS = 1;
          this.scrollerWidth  = Math.round(this._baseW * this.scale);
          this.scrollerHeight = Math.round(this._baseH * this.scale);
  
          this.maxScrollX = this.wrapperWidth  - this.scrollerWidth  + EPS;
          this.maxScrollY = this.wrapperHeight - this.scrollerHeight + EPS;
  
          this.hasHorizontalScroll = this.options.scrollX && this.maxScrollX < 0;
          this.hasVerticalScroll   = this.options.scrollY && this.maxScrollY < 0;
  
          // 현재 위치를 새 경계로 즉시 클램프
          var nx = this.x, ny = this.y;
          if (!this.hasHorizontalScroll || nx > 0) nx = 0;
          else if (nx < this.maxScrollX) nx = this.maxScrollX;
  
          if (!this.hasVerticalScroll || ny > 0) ny = 0;
          else if (ny < this.maxScrollY) ny = this.maxScrollY;
  
          if (nx !== this.x || ny !== this.y) this._translate(nx, ny);
  
          this._execEvent('refresh');
        };
      })();
  
      /* ───── _zoomStart/_zoom 패치: 경계 실시간 재계산 (baseH 사용) ───── */
      (function patchZoom(){
        var U = IScrollZoom.utils || {};
        var _origZoomStart = IScrollZoom.prototype._zoomStart;
  
        IScrollZoom.prototype._zoomStart = function(e){
          if (_origZoomStart) _origZoomStart.call(this, e);
          this.__pzEMA = { dist:null, cx:null, cy:null, prevCx:null, prevCy:null };
          this.__pzStartAt = (U.getTime ? U.getTime() : Date.now());
  
          // 혹시 아직 base가 없다면 지금 즉시 측정
          if (!this._baseH || !this._baseW) {
            var m = measureBaseSize(this.wrapper, this.scroller);
            this._baseW = m.baseW;
            this._baseH = m.baseH;
          }
        };
  
        function recomputeBounds(ctx){
          ctx.wrapperWidth  = ctx.wrapper.clientWidth;
          ctx.wrapperHeight = Math.min(ctx.wrapper.clientHeight, viewportHeight());
  
          var EPS = 1;
          // baseH/W * scale 을 사용 (offsetHeight 의존 X)
          ctx.scrollerWidth  = Math.round((ctx._baseW || 1) * ctx.scale);
          ctx.scrollerHeight = Math.round((ctx._baseH || 1) * ctx.scale);
  
          ctx.maxScrollX = ctx.wrapperWidth  - ctx.scrollerWidth  + EPS;
          ctx.maxScrollY = ctx.wrapperHeight - ctx.scrollerHeight + EPS;
  
          ctx.hasHorizontalScroll = ctx.options.scrollX && ctx.maxScrollX < 0;
          ctx.hasVerticalScroll   = ctx.options.scrollY && ctx.maxScrollY < 0;
        }
  
        IScrollZoom.prototype._zoom = function(ev){
          var ET = IScrollZoom.utils && IScrollZoom.utils.eventType;
          if (!this.enabled || (ET && ET[ev.type] !== this.initiated)) return;
          if (this.options.preventDefault && ev.cancelable) ev.preventDefault();
          if (!ev.touches || !ev.touches[1]) return;
  
          var t0 = ev.touches[0], t1 = ev.touches[1];
          var dx = Math.abs(t0.pageX - t1.pageX);
          var dy = Math.abs(t0.pageY - t1.pageY);
          var dist = Math.sqrt(dx*dx + dy*dy);
          var cx   = (t0.pageX + t1.pageX)/2;
          var cy   = (t0.pageY + t1.pageY)/2;
  
          // EMA로 흔들림 완화
          var em = this.__pzEMA;
          var aD = 0.28, aC = 0.30;
          if (em.dist == null) { em.dist = dist; em.cx = cx; em.cy = cy; }
          else {
            em.dist += aD*(dist - em.dist);
            em.cx   += aC*(cx   - em.cx);
            em.cy   += aC*(cy   - em.cy);
          }
  
          var now   = (U.getTime ? U.getTime() : Date.now());
          var boost = (now - this.__pzStartAt <= 120) ? (IS_ANDROID ? 1.10 : 1.05) : 1.0;
          var desired = this.startScale * Math.pow(em.dist / this.touchesDistanceStart, boost);
  
          var min = this.options.zoomMin, max = this.options.zoomMax;
          var n = desired; if (n < min) n = min; else if (n > max) n = max;
  
          var hitMax = desired > max + 1e-6;
          var hitMin = desired < min - 1e-6;
  
          var k  = n / this.startScale;
          var nx = this.originX - this.originX*k + this.startX;
          var ny = this.originY - this.originY*k + this.startY;
  
          this.scale = n;
  
          // baseH 기준 경계 재계산
          recomputeBounds(this);
  
          // 경계 클램프
          if (nx > 0 || nx < this.maxScrollX) {
            nx = this.options.bounce ? (this.x + (nx - this.x)/3) : (nx > 0 ? 0 : this.maxScrollX);
          }
          if (ny > 0 || ny < this.maxScrollY) {
            ny = this.options.bounce ? (this.y + (ny - this.y)/3) : (ny > 0 ? 0 : this.maxScrollY);
          }
  
          this.scrollTo(nx, ny, 0);
          this.scaled = true;
  
          // 최대/최소 접촉 시 리베이스 + 2핀치 패닝
          if (hitMax || hitMin){
            if (em.prevCx != null){
              var dcx = em.cx - em.prevCx;
              var dcy = em.cy - em.prevCy;
              this.scrollBy(-dcx, -dcy, 0);
            }
            this.startScale = n;
            this.touchesDistanceStart = em.dist;
            this.startX = this.x; this.startY = this.y;
            this.originX = Math.abs(t0.pageX + t1.pageX)/2 + this.wrapperOffset.left - this.x;
            this.originY = Math.abs(t0.pageY + t1.pageY)/2 + this.wrapperOffset.top  - this.y;
          }
  
          em.prevCx = em.cx; em.prevCy = em.cy;
  
          if (this._updateNativeZoomingByScale) this._updateNativeZoomingByScale(this.scale);
        };
      })();
  
      /* ───── _zoomEnd 패치: 점프 제거 ───── */
      (function patchZoomEnd(){
        var ET = IScrollZoom.utils && IScrollZoom.utils.eventType;
        IScrollZoom.prototype._zoomEnd = function(e){
          if (!this.enabled || (ET && ET[e.type] !== this.initiated)) return;
          if (this.options.preventDefault && e.cancelable) e.preventDefault();
  
          this.isInTransition = 0;
          this.initiated = 0;
  
          if (this.scale > this.options.zoomMax) this.scale = this.options.zoomMax;
          if (this.scale < this.options.zoomMin) this.scale = this.options.zoomMin;
  
          this.refresh();
  
          var x = this.x, y = this.y;
          if (!this.hasHorizontalScroll || x > 0) x = 0;
          else if (x < this.maxScrollX) x = this.maxScrollX;
  
          if (!this.hasVerticalScroll || y > 0) y = 0;
          else if (y < this.maxScrollY) y = this.maxScrollY;
  
          if (x !== this.x || y !== this.y) {
            this.scrollTo(x, y, this.options.bounceTime);
          } else {
            this._execEvent('scrollEnd');
          }
          this.scaled = false;
          this._execEvent('zoomEnd');
        };
      })();
  
      /* ───── DOM 유틸 ───── */
      function wrapIntoScroller(root){
        if (root.firstElementChild && root.firstElementChild.classList.contains('iscroll-scroller')) {
          return root.firstElementChild;
        }
        var sc = document.createElement('div');
        sc.className = 'iscroll-scroller';
        while (root.firstChild) sc.appendChild(root.firstChild);
        root.appendChild(sc);
        return sc;
      }
      function afterImages(el, cb){
        var imgs = el.querySelectorAll('img');
        if (!imgs.length) { cb(); return; }
        var left = imgs.length, done=false, t=setTimeout(finish, 1500);
        imgs.forEach(function(im){
          if (im.complete) { if(--left===0) finish(); }
          else{
            im.addEventListener('load', chk, {once:true});
            im.addEventListener('error', chk, {once:true});
            if (im.decode) im.decode().catch(function(){});
          }
          function chk(){ if(--left===0) finish(); }
        });
        function finish(){ if(done) return; done=true; clearTimeout(t); cb(); }
      }
  
      /* ───── 세팅 ───── */
      function setup(root){
        var scrollerEl = wrapIntoScroller(root);
  
        var z = new IScrollZoom(root, {
          zoom: true,
          zoomMin: 1,
          zoomMax: 4.0,
          startZoom: 1,
  
          scrollX: true,
          scrollY: true,
          freeScroll: true,
  
          useTransition: false,
          useTransform: true,
          HWCompositing: true,
  
          disableMouse: true,
          disablePointer: true,
          disableTouch: false,
  
          bounce: true,
          bounceTime: IS_ANDROID ? 450 : 350,
          deceleration: IS_ANDROID ? 0.00095 : 0.0006,
          momentum: true,
  
          click: true,
          tap: true,
  
          preventDefault: true,
          preventDefaultException: { tagName: /^(INPUT|TEXTAREA|BUTTON|SELECT|A)$/i }
        });
  
        // 네이티브 알림(히스테리시스)
        var _zooming = false, TH_IN=1.02, TH_OUT=1.01;
        function setZooming(on){ if (_zooming===on) return; _zooming=on; tellNative(on); }
        function updateNativeZoomingByScale(scale){
          var next = _zooming ? (scale > TH_OUT) : (scale > TH_IN);
          if (next !== _zooming) setZooming(next);
        }
        z._updateNativeZoomingByScale = updateNativeZoomingByScale;
  
        function enterZoomMode(){
          z.options.bounce = false;
          z.options.scrollX = true;
          z.options.scrollY = true;
          z.options.freeScroll = true;
          z.options.preventDefault = true;
          root.classList.add('is-zooming');
          root.style.touchAction = 'none';
          setZooming(true);
          z.refresh();
        }
        function enterPageMode(){
          z.options.bounce = true;
          z.options.scrollX = false;
          z.options.scrollY = false;
          z.options.freeScroll = false;
          z.options.preventDefault = false;
          root.classList.remove('is-zooming');
          root.style.touchAction = 'pan-y pinch-zoom';
          if (z.scale !== 1) z.zoom(1, root.clientWidth/2, root.clientHeight/2, 0);
          setZooming(false);
          z.refresh();
        }
  
        enterPageMode();
  
        z.on('zoomStart', enterZoomMode);
        z.on('zoomEnd',   function(){ (z.scale <= TH_OUT) ? enterPageMode() : enterZoomMode(); });
        z.on('scrollEnd', function(){ if (z.scale <= TH_OUT) enterPageMode(); });
  
        // 더블탭
        (function bindDoubleTap(){
          var lastT=0,lastX=0,lastY=0, DUR=260, MOVE=16;
          root.addEventListener('touchend', function(ev){
            if (ev.touches && ev.touches.length) return;
            var t = ev.changedTouches ? ev.changedTouches[0] : ev;
            var now = performance.now();
            var isDT = (now - lastT) < DUR && Math.hypot(t.clientX-lastX, t.clientY-lastY) < MOVE;
            lastT = now; lastX = t.clientX; lastY = t.clientY;
            if (!isDT) return;
  
            ev.preventDefault();
            var to = (z.scale <= TH_OUT) ? Math.min(2.0, z.options.zoomMax) : 1;
            if (to > 1) enterZoomMode();
            z.zoom(to, t.pageX, t.pageY, IS_ANDROID ? 220 : 180);
            if (to === 1) setTimeout(enterPageMode, IS_ANDROID ? 240 : 200);
          }, {passive:false});
        })();
  
        // 이미지 로드 후: base 측정 → 경계 안정화
        afterImages(scrollerEl, function(){
          var m = measureBaseSize(root, scrollerEl);
          z._baseW = m.baseW;
          z._baseH = m.baseH;
          z.refresh();
        });
  
        // viewport 변동 즉시 반영
        if (window.visualViewport) {
          var vvHandler = function(){ z.refresh(); };
          visualViewport.addEventListener('resize', vvHandler);
          visualViewport.addEventListener('scroll', vvHandler);
        }
  
        root._iscrollZoom = z;
      }
  
      function init(){ document.querySelectorAll('.zoom-container').forEach(setup); }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, {once:true});
      } else {
        init();
      }
    });
  })(jQuery);
  