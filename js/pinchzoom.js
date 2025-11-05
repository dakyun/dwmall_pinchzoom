/**
 * PinchZoom (iScrollZoom 기반) — 최종 안정판 (빈 화면/하단 미도달 해결)
 * - baseH = 1x 실제 렌더 높이 측정/캐싱 → scrollerHeight = baseH * scale
 * - viewport = visualViewport.height - bottomInset() (없으면 innerHeight 기반)
 * - 줌 중/끝 모두 즉시-클램프(하드) → 흰 빈 화면 방지
 * - 줌 모드: window/page 스크롤 완전 잠금 + momentum/bounce OFF
 * - 더블탭 확대/축소 포함
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
  
      /* ───────── 네이티브 브릿지(옵션) ───────── */
      function tellNative(zooming){
        try { window.AndroidZoomBridge && AndroidZoomBridge.setZooming(zooming); } catch(e){}
      }
  
      /* ───────── 공통 유틸 ───────── */
      function viewportHeight(){
        return (window.visualViewport && window.visualViewport.height)
          ? Math.round(window.visualViewport.height)
          : window.innerHeight;
      }
      // iOS 주소/툴바/홈인디케이터 보정
      function bottomInset(){
        var vh = (window.visualViewport && window.visualViewport.height) ? window.visualViewport.height : window.innerHeight;
        var ih = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || vh;
        var diff = Math.max(0, Math.round(ih - vh));
        var SAFE = 40; // 24→40 : 기기에 맞춰 32~48 사이로 조정 가능
        return diff + SAFE;
      }
      function measureBaseSize(root, scroller){
        var content = scroller.firstElementChild || scroller;
        var rect = content.getBoundingClientRect(); // 1x 렌더 값
        var baseW = Math.max(1, Math.round(rect.width));
        var baseH = Math.max(1, Math.round(rect.height));
        return { baseW, baseH };
      }
  
      /* ───────── refresh() 패치: viewport/baseH 기준 경계 재산출 ───────── */
      (function patchRefresh(){
        var _orig = IScrollZoom.prototype.refresh;
        IScrollZoom.prototype.refresh = function(){
          _orig.call(this);
  
          // viewport 보정
          this.wrapperHeight = Math.max(
            1,
            Math.min(this.wrapper.clientHeight, viewportHeight()) - bottomInset()
          );
          this.wrapperWidth  = this.wrapper.clientWidth;
  
          // base 미측정 시 1회 측정
          if (!this._baseH || !this._baseW) {
            var m = measureBaseSize(this.wrapper, this.scroller);
            this._baseW = m.baseW;
            this._baseH = m.baseH;
          }
  
          // 경계 계산 (여유)
          var EPS = 2; // 끝픽셀까지 보이도록 약간 여유
          this.scrollerWidth  = Math.round(this._baseW * this.scale);
          this.scrollerHeight = Math.round(this._baseH * this.scale);
  
          this.maxScrollX = this.wrapperWidth  - this.scrollerWidth  + EPS;
          this.maxScrollY = this.wrapperHeight - this.scrollerHeight + EPS;
  
          this.hasHorizontalScroll = this.options.scrollX && this.maxScrollX < 0;
          this.hasVerticalScroll   = this.options.scrollY && this.maxScrollY < 0;
  
          // 즉시-클램프(빈 화면 방지)
          var nx = this.x, ny = this.y;
          if (!this.hasHorizontalScroll || nx > 0) nx = 0;
          else if (nx < this.maxScrollX) nx = this.maxScrollX;
  
          if (!this.hasVerticalScroll || ny > 0) ny = 0;
          else if (ny < this.maxScrollY) ny = this.maxScrollY;
  
          if (nx !== this.x || ny !== this.y) this._translate(nx, ny);
  
          this._execEvent('refresh');
        };
      })();
  
      /* ───────── _zoomStart/_zoom 패치: 경계 실시간 재계산(하드 클램프) ───────── */
      (function patchZoom(){
        var U = IScrollZoom.utils || {};
        var _origZoomStart = IScrollZoom.prototype._zoomStart;
  
        IScrollZoom.prototype._zoomStart = function(e){
          if (_origZoomStart) _origZoomStart.call(this, e);
          this.__pzEMA = { dist:null, cx:null, cy:null, prevCx:null, prevCy:null };
          this.__pzStartAt = (U.getTime ? U.getTime() : Date.now());
  
          if (!this._baseH || !this._baseW) {
            var m = measureBaseSize(this.wrapper, this.scroller);
            this._baseW = m.baseW;
            this._baseH = m.baseH;
          }
        };
  
        function recomputeBounds(ctx){
          ctx.wrapperWidth  = ctx.wrapper.clientWidth;
          ctx.wrapperHeight = Math.max(
            1,
            Math.min(ctx.wrapper.clientHeight, viewportHeight()) - bottomInset()
          );
  
          var EPS = 2;
          ctx.scrollerWidth  = Math.round((ctx._baseW || 1) * ctx.scale);
          ctx.scrollerHeight = Math.round((ctx._baseH || 1) * ctx.scale);
  
          ctx.maxScrollX = ctx.wrapperWidth  - ctx.scrollerWidth  + EPS;
          ctx.maxScrollY = ctx.wrapperHeight - ctx.scrollerHeight + EPS;
  
          ctx.hasHorizontalScroll = ctx.options.scrollX && ctx.maxScrollX < 0;
          ctx.hasVerticalScroll   = ctx.options.scrollY && ctx.maxScrollY < 0;
  
          // 즉시-클램프(줌 중에도 빈 화면 방지)
          var cx = ctx.x, cy = ctx.y;
          if (!ctx.hasHorizontalScroll || cx > 0) cx = 0;
          else if (cx < ctx.maxScrollX) cx = ctx.maxScrollX;
          if (!ctx.hasVerticalScroll || cy > 0) cy = 0;
          else if (cy < ctx.maxScrollY) cy = ctx.maxScrollY;
          if (cx !== ctx.x || cy !== ctx.y) ctx._translate(cx, cy);
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
  
          // 경계 재산출 + 즉시-클램프
          recomputeBounds(this);
  
          // 하드 클램프(보간 X, bounce=false 상태)
          if (nx > 0) nx = 0;
          else if (nx < this.maxScrollX) nx = this.maxScrollX;
          if (ny > 0) ny = 0;
          else if (ny < this.maxScrollY) ny = this.maxScrollY;
  
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
  
      /* ───────── _zoomEnd 패치: 점프 제거 + 하드 클램프 ───────── */
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
  
      /* ───────── DOM 유틸 ───────── */
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
  
      /* ───────── 세팅 ───────── */
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
  
        /* ── 페이지 스크롤 잠금(줌 모드) ── */
        var _scrollLock = { on:false, y:0, tmHandler:null };
        function lockPageScroll(){
          if (_scrollLock.on) return;
          _scrollLock.on = true;
          _scrollLock.y = window.scrollY || window.pageYOffset || 0;
          document.body.style.position = 'fixed';
          document.body.style.top = (-_scrollLock.y) + 'px';
          document.body.style.left = '0';
          document.body.style.right = '0';
          document.body.style.width = '100%';
          document.body.style.overscrollBehavior = 'none';
          _scrollLock.tmHandler = function evBlock(e){ if (!e.cancelable) return; e.preventDefault(); };
          window.addEventListener('touchmove', _scrollLock.tmHandler, {passive:false});
        }
        function unlockPageScroll(){
          if (!_scrollLock.on) return;
          _scrollLock.on = false;
          document.body.style.position = '';
          document.body.style.top = '';
          document.body.style.left = '';
          document.body.style.right = '';
          document.body.style.width = '';
          document.body.style.overscrollBehavior = '';
          window.removeEventListener('touchmove', _scrollLock.tmHandler, {passive:false});
          window.scrollTo(0, _scrollLock.y|0);
        }
  
        // 네이티브 알림(히스테리시스)
        var _zooming = false, TH_IN=1.02, TH_OUT=1.01;
        function setZooming(on){ if (_zooming===on) return; _zooming=on; tellNative(on); }
        function updateNativeZoomingByScale(scale){
          var next = _zooming ? (scale > TH_OUT) : (scale > TH_IN);
          if (next !== _zooming) setZooming(next);
        }
        z._updateNativeZoomingByScale = updateNativeZoomingByScale;
  
        function enterZoomMode(){
          z.options.bounce = false;      // 흰여백/튕김 제거
          z.options.momentum = false;    // 관성 제거
          z.options.scrollX = true;
          z.options.scrollY = true;
          z.options.freeScroll = true;
          z.options.preventDefault = true;
  
          root.classList.add('is-zooming');
          root.style.touchAction = 'none';
  
          lockPageScroll();              // 윈도우 스크롤 잠금
          setZooming(true);
          z.refresh();
        }
        function enterPageMode(){
          z.options.bounce = true;
          z.options.momentum = true;     // 원복
          z.options.scrollX = false;
          z.options.scrollY = false;
          z.options.freeScroll = false;
          z.options.preventDefault = false;
  
          root.classList.remove('is-zooming');
          root.style.touchAction = 'pan-y pinch-zoom';
  
          if (z.scale !== 1) z.zoom(1, root.clientWidth/2, root.clientHeight/2, 0);
  
          unlockPageScroll();            // 잠금 해제
          setZooming(false);
          z.refresh();
        }
  
        // 초기: 1x (페이지 모드)
        enterPageMode();
  
        // 이벤트 훅
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
  
        // 이미지 로드 후: base/높이 고정 → 경계 안정화
        afterImages(scrollerEl, function(){
          var img = scrollerEl.querySelector('img');
          if (img && img.naturalWidth && img.naturalHeight) {
            var w   = root.clientWidth || scrollerEl.clientWidth || img.clientWidth || img.naturalWidth;
            var h1x = Math.ceil(img.naturalHeight * (w / img.naturalWidth)) + 1; // 올림 + 1px 여유
  
            scrollerEl.style.height = h1x + 'px';
            img.style.height = h1x + 'px';
  
            z._baseW = Math.max(1, Math.round(w));
            z._baseH = h1x;
          }
          z.refresh();
        });
  
        // viewport 변동 즉시 반영
        if (window.visualViewport) {
          var vvHandler = function(){ z.refresh(); };
          visualViewport.addEventListener('resize', vvHandler);
          visualViewport.addEventListener('scroll', vvHandler);
        }
  
        // 디버그 핸들
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
  