/**
 * PinchZoom (iScrollZoom 기반) — iOS/Android 대응 안정판
 * - 확대 중 실시간 경계 재계산 (scrollerHeight = baseHeight * scale)
 * - refresh() 패치: viewport = visualViewport.height 사용(없으면 innerHeight)
 * - _zoomEnd 점프 제거: 현재 x/y 기준 경계 클램프
 * - 주소창/하단바 변화(visualViewport resize/scroll) 즉시 반영
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
  
      /* ───────────────── 네이티브 브릿지(옵션) ───────────────── */
      function tellNative(zooming){
        try { window.AndroidZoomBridge && AndroidZoomBridge.setZooming(zooming); } catch(e){}
      }
  
      /* ───────────────── refresh() 패치: viewport 보정 ─────────────────
         iOS Safari에서 주소창/하단바 상태에 따라 innerHeight/클라이언트 높이가 들쭉날쭉.
         항상 visualViewport.height(없으면 innerHeight)로 wrapperHeight를 덮어써서
         maxScrollY가 정확히 계산되도록 한다. */
      (function patchRefresh(){
        var _orig = IScrollZoom.prototype.refresh;
        IScrollZoom.prototype.refresh = function(){
          // 기존 계산
          _orig.call(this);
  
          // 1) viewport 높이를 실제 보이는 화면 기준으로 강제
          var vh = (window.visualViewport && window.visualViewport.height)
                    ? Math.round(window.visualViewport.height)
                    : window.innerHeight;
  
          this.wrapperHeight = Math.min(this.wrapper.clientHeight, vh);
  
          // 2) 스케일 반영된 콘텐츠 크기 기준 경계 재계산
          var EPS = 1; // 끝픽셀 보이도록 약간의 여유
          this.scrollerWidth  = Math.round(this.scroller.offsetWidth  * this.scale);
          this.scrollerHeight = Math.round(this.scroller.offsetHeight * this.scale);
  
          this.maxScrollX = this.wrapperWidth  - this.scrollerWidth  + EPS;
          this.maxScrollY = this.wrapperHeight - this.scrollerHeight + EPS;
  
          this.hasHorizontalScroll = this.options.scrollX && this.maxScrollX < 0;
          this.hasVerticalScroll   = this.options.scrollY && this.maxScrollY < 0;
  
          // 3) 현재 위치를 새 경계로 즉시 클램프(하단 못 내려가는 문제 방지)
          var nx = this.x, ny = this.y;
          if (!this.hasHorizontalScroll || nx > 0) nx = 0;
          else if (nx < this.maxScrollX) nx = this.maxScrollX;
  
          if (!this.hasVerticalScroll || ny > 0) ny = 0;
          else if (ny < this.maxScrollY) ny = this.maxScrollY;
  
          if (nx !== this.x || ny !== this.y) this._translate(nx, ny);
  
          // 인디케이터 등에게 갱신 알림
          this._execEvent('refresh');
        };
      })();
  
      /* ───────────────── _zoomStart/_zoom 패치: 실시간 경계 재계산 ───────────────── */
      (function patchZoom(){
        var U = IScrollZoom.utils || {};
        var _origZoomStart = IScrollZoom.prototype._zoomStart;
  
        IScrollZoom.prototype._zoomStart = function(e){
          if (_origZoomStart) _origZoomStart.call(this, e);
          this.__pzEMA = { dist:null, cx:null, cy:null, prevCx:null, prevCy:null };
          this.__pzStartAt = (U.getTime ? U.getTime() : Date.now());
        };
  
        // 확대 중 경계를 즉시 재계산 (refresh의 경량 버전)
        function recomputeBounds(ctx){
          var vw = ctx.wrapper.clientWidth;
          var vh = Math.min(
            ctx.wrapper.clientHeight,
            (window.visualViewport ? window.visualViewport.height : window.innerHeight)
          );
  
          ctx.wrapperWidth  = vw;
          ctx.wrapperHeight = vh;
  
          // transform은 레이아웃에 반영되지 않으므로 offset * scale 로 계산
          var baseW = ctx.scroller.offsetWidth;
          var baseH = ctx.scroller.offsetHeight;
  
          // 디코딩 타이밍 등으로 0 나오는 경우 보정
          if (!baseW || !baseH) {
            var rect = ctx.scroller.getBoundingClientRect();
            baseW = baseW || Math.max(1, Math.round(rect.width  / (ctx.scale || 1)));
            baseH = baseH || Math.max(1, Math.round(rect.height / (ctx.scale || 1)));
          }
  
          ctx.scrollerWidth  = Math.round(baseW * ctx.scale);
          ctx.scrollerHeight = Math.round(baseH * ctx.scale);
  
          var EPS = 1;
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
  
          // 하드 클램프(오버슈트 제거)
          var min = this.options.zoomMin, max = this.options.zoomMax;
          var n   = desired;
          if (n < min) n = min; else if (n > max) n = max;
  
          var hitMax = desired > max + 1e-6;
          var hitMin = desired < min - 1e-6;
  
          // 스케일 적용 전후 위치 보존 변환
          var k  = n / this.startScale;
          var nx = this.originX - this.originX*k + this.startX;
          var ny = this.originY - this.originY*k + this.startY;
  
          // ① 스케일 업데이트
          this.scale = n;
  
          // ② 새 스케일 기준 경계 즉시 재계산(핵심!!)
          recomputeBounds(this);
  
          // ③ 현재 이동 목표를 새 경계에 맞게 클램프
          if (nx > 0 || nx < this.maxScrollX) {
            nx = this.options.bounce ? (this.x + (nx - this.x)/3) : (nx > 0 ? 0 : this.maxScrollX);
          }
          if (ny > 0 || ny < this.maxScrollY) {
            ny = this.options.bounce ? (this.y + (ny - this.y)/3) : (ny > 0 ? 0 : this.maxScrollY);
          }
  
          // ④ 적용
          this.scrollTo(nx, ny, 0);
          this.scaled = true;
  
          // 최대/최소에 닿으면: 리베이스 + 2핀치 패닝
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
  
      /* ───────────────── _zoomEnd 패치: 점프 제거 ───────────────── */
      (function patchZoomEnd(){
        var ET = IScrollZoom.utils && IScrollZoom.utils.eventType;
        IScrollZoom.prototype._zoomEnd = function(e){
          if (!this.enabled || (ET && ET[e.type] !== this.initiated)) return;
          if (this.options.preventDefault && e.cancelable) e.preventDefault();
  
          this.isInTransition = 0;
          this.initiated = 0;
  
          // 배율 하드 클램프
          if (this.scale > this.options.zoomMax) this.scale = this.options.zoomMax;
          if (this.scale < this.options.zoomMin) this.scale = this.options.zoomMin;
  
          // 현재 위치 기준으로만 경계 클램프
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
  
      /* ───────────────── 유틸 ───────────────── */
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
        var left = imgs.length, done=false, t=setTimeout(finish, 1200);
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
  
      /* ───────────────── 컨테이너 세팅 ───────────────── */
      function setup(root){
        var scrollerEl = wrapIntoScroller(root);
  
        var z = new IScrollZoom(root, {
          zoom: true,
          zoomMin: 1,
          zoomMax: 4.0,           // 필요하면 5.0 등으로
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
  
          bounce: true,                   // 페이지 모드 기본값
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
        function setZooming(on){
          if (_zooming === on) return;
          _zooming = on; tellNative(on);
        }
        function updateNativeZoomingByScale(scale){
          var next = _zooming ? (scale > TH_OUT) : (scale > TH_IN);
          if (next !== _zooming) setZooming(next);
        }
        z._updateNativeZoomingByScale = updateNativeZoomingByScale;
  
        // 모드 전환: 줌 중엔 bounce 끔 / 1x 복귀 시 즉시 페이지 스크롤
        function enterZoomMode(){
          z.options.bounce = false;            // 흰여백/튕김 제거
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
  
        // 이미지 로드 후: 1x 기준 높이를 고정해 베이스를 안정화
        afterImages(scrollerEl, function(){
          var img = scrollerEl.querySelector('img');
          if (img && img.naturalWidth && img.naturalHeight) {
            var w = root.clientWidth || scrollerEl.clientWidth || img.clientWidth || img.naturalWidth;
            var h1x = Math.round(img.naturalHeight * (w / img.naturalWidth));
            scrollerEl.style.height = h1x + 'px';
          }
          z.refresh();
        });
  
        // iOS 주소창/하단바 변화에 즉시 대응
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
  