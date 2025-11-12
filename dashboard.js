// Dashboard для просмотра истории времени
// Использует telegram_id из глобальной области видимости index.html

const API_BASE = 'https://betters-technology.site/webhook';

// Текущий отображаемый месяц (для навигации)
let currentDashboardMonth = new Date();
currentDashboardMonth.setDate(1); // Первое число месяца

// Кэш данных календаря: ключ - "YYYY-MM", значение - { calendar, month_summary }
const calendarCache = {};

// Кэш деталей дня: ключ - "YYYY-MM-DD", значение - данные дня
const dayDetailsCache = {};

// Кэш сводки по проектам (загружается один раз)
let projectsSummaryCache = null;
let projectsSummaryLoading = false;

// Кэш сводки по проектам за месяц: ключ - "YYYY-MM", значение - массив проектов
const monthProjectsSummaryCache = {};

// Получение ключа месяца для кэша
function getMonthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// Загрузка данных месяца с API
async function loadMonthData(year, month) {
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0);
  
  const startStr = formatDateForAPI(startDate);
  const endStr = formatDateForAPI(endDate);
  
  const response = await fetch(`${API_BASE}/get-time-entries-calendar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telegram_id: parseInt(telegram_id),
      start_date: startStr,
      end_date: endStr
    })
  });
  
  const data = await response.json();
  
  if (!data.calendar || !data.month_summary) {
    throw new Error('Неверный формат данных');
  }
  
  return data;
}

// Предзагрузка данных за несколько месяцев вокруг центрального
async function preloadMonths(centerYear, centerMonth, monthsBack = 3, monthsForward = 1) {
  const monthsToLoad = [];
  
  // Загружаем месяцы назад
  for (let i = monthsBack; i >= 1; i--) {
    const month = new Date(centerYear, centerMonth - i, 1);
    monthsToLoad.push({
      year: month.getFullYear(),
      month: month.getMonth(),
      key: getMonthKey(month.getFullYear(), month.getMonth())
    });
  }
  
  // Текущий месяц
  monthsToLoad.push({
    year: centerYear,
    month: centerMonth,
    key: getMonthKey(centerYear, centerMonth)
  });
  
  // Загружаем месяцы вперед
  for (let i = 1; i <= monthsForward; i++) {
    const month = new Date(centerYear, centerMonth + i, 1);
    monthsToLoad.push({
      year: month.getFullYear(),
      month: month.getMonth(),
      key: getMonthKey(month.getFullYear(), month.getMonth())
    });
  }
  
  // Загружаем только те месяцы, которых нет в кэше
  const monthsToFetch = monthsToLoad.filter(m => !calendarCache[m.key]);
  
  if (monthsToFetch.length === 0) {
    return; // Все уже в кэше
  }
  
  // Загружаем все недостающие месяцы параллельно
  const loadPromises = monthsToFetch.map(({ year, month, key }) =>
    loadMonthData(year, month)
      .then(data => {
        calendarCache[key] = data;
      })
      .catch(error => {
        console.error(`Ошибка загрузки месяца ${key}:`, error);
        // Не прерываем загрузку других месяцев
      })
  );
  
  await Promise.all(loadPromises);
}

// Открытие дашборда
async function openDashboard() {
  const overlay = document.getElementById('dashboardOverlay');
  const content = document.getElementById('dashboardContent');
  
  overlay.style.display = 'flex';
  
  // Сбрасываем на текущий месяц
  currentDashboardMonth = new Date();
  currentDashboardMonth.setDate(1);
  
  const year = currentDashboardMonth.getFullYear();
  const month = currentDashboardMonth.getMonth();
  
  content.innerHTML = '<p class="loading-text">Загрузка...</p>';
  
  try {
    // Предзагружаем 6 месяцев назад и 1 вперед (для быстрой навигации)
    await preloadMonths(year, month, 6, 1);
    
    // Рендерим календарь из кэша
    await renderCalendar();
  } catch (error) {
    content.innerHTML = `<p style="color: #e74c3c;">❌ Ошибка загрузки: ${error.message}</p>`;
  }
}

// Закрытие дашборда
function closeDashboard() {
  document.getElementById('dashboardOverlay').style.display = 'none';
}

// Экспортируем функции для использования в HTML
window.openDashboard = openDashboard;
window.closeDashboard = closeDashboard;
window.renderCalendar = renderCalendar;

// Рендеринг календаря
async function renderCalendar() {
  const content = document.getElementById('dashboardContent');
  
  // Используем сохраненный месяц
  const year = currentDashboardMonth.getFullYear();
  const month = currentDashboardMonth.getMonth();
  const monthKey = getMonthKey(year, month);
  
  try {
    // Проверяем кэш
    let data = calendarCache[monthKey];
    
    // Если данных нет в кэше, показываем загрузку и загружаем
    if (!data) {
      content.innerHTML = '<p class="loading-text">Загрузка...</p>';
      data = await loadMonthData(year, month);
      calendarCache[monthKey] = data;
    }
    
    if (!data.calendar || !data.month_summary) {
      content.innerHTML = '<p>❌ Ошибка: неверный формат данных</p>';
      return;
    }
    
    // Сразу рендерим календарь (не ждем сводку по проектам)
    let html = buildCalendarHTML(data.calendar, data.month_summary, year, month);
    content.innerHTML = html;
    
    // Настраиваем обработчики кликов на дни
    setupDayClickHandlers();
    
    // Настраиваем обработчики кликов на проекты
    setupProjectClickHandlers();
    
    // Настраиваем кнопки навигации
    setupMonthNavigation();
    
    // Асинхронно загружаем сводку по проектам за текущий месяц
    loadMonthProjectsSummaryAsync(content, year, month);
    
    // Добавляем индикатор загрузки общей сводки по проектам (если её еще нет в кэше)
    if (projectsSummaryCache === null) {
      content.insertAdjacentHTML('beforeend', `
        <div class="projects-summary-loading" style="margin-top: 24px; padding-top: 24px; border-top: 2px solid #eee; text-align: center; color: #666;">
          <p style="margin: 0;">📊 Загрузка сводки по проектам...</p>
        </div>
      `);
    }
    
    // Асинхронно загружаем общую сводку по проектам (если её еще нет в кэше)
    loadProjectsSummaryAsync(content);
    
  } catch (error) {
    content.innerHTML = `<p style="color: #e74c3c;">❌ Ошибка загрузки календаря: ${error.message}</p>`;
  }
}

// Асинхронная загрузка сводки по проектам (не блокирует отображение календаря)
async function loadProjectsSummaryAsync(contentContainer) {
  // Если уже загружается - не запускаем повторно
  if (projectsSummaryLoading) {
    return;
  }
  
  // Если уже есть в кэше - добавляем сразу
  if (projectsSummaryCache !== null) {
    appendProjectsSummary(contentContainer, projectsSummaryCache);
    return;
  }
  
  // Загружаем сводку
  projectsSummaryLoading = true;
  
  try {
    const projectsSummary = await loadProjectsSummary();
    projectsSummaryCache = projectsSummary;
    
    if (projectsSummary && projectsSummary.length > 0) {
      appendProjectsSummary(contentContainer, projectsSummary);
    } else {
      // Убираем индикатор загрузки, если сводка пустая
      const loadingIndicator = contentContainer.querySelector('.projects-summary-loading');
      if (loadingIndicator) {
        loadingIndicator.remove();
      }
    }
  } catch (error) {
    console.error('Ошибка загрузки сводки по проектам:', error);
    // Убираем индикатор загрузки при ошибке
    const loadingIndicator = contentContainer.querySelector('.projects-summary-loading');
    if (loadingIndicator) {
      loadingIndicator.remove();
    }
  } finally {
    projectsSummaryLoading = false;
  }
}

// Добавление сводки по проектам в контейнер
function appendProjectsSummary(contentContainer, projectsSummary) {
  // Проверяем, что контейнер все еще существует и мы все еще на календаре
  if (!contentContainer || !contentContainer.querySelector('.dashboard-day')) {
    return; // Уже не на календаре
  }
  
  // Проверяем, не добавлена ли уже сводка
  if (contentContainer.querySelector('.projects-summary-container')) {
    return; // Уже добавлена
  }
  
  // Убираем индикатор загрузки, если он есть
  const loadingIndicator = contentContainer.querySelector('.projects-summary-loading');
  if (loadingIndicator) {
    loadingIndicator.remove();
  }
  
  const summaryHTML = buildProjectsSummaryHTML(projectsSummary);
  contentContainer.insertAdjacentHTML('beforeend', summaryHTML);
  
  // Настраиваем обработчики кликов на проекты (после добавления)
  setupProjectClickHandlers();
}

// Загрузка сводки по проектам за конкретный месяц
async function loadMonthProjectsSummary(year, month) {
  const monthKey = getMonthKey(year, month);
  
  // Проверяем кэш
  if (monthProjectsSummaryCache[monthKey]) {
    return monthProjectsSummaryCache[monthKey];
  }
  
  try {
    const response = await fetch(`${API_BASE}/get-month-statistics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: parseInt(telegram_id),
        year: year,
        month: month + 1 // API ожидает месяц от 1 до 12
      })
    });
    
    const data = await response.json();
    
    // Извлекаем массив проектов
    const projects = data.projects || [];
    
    // Сохраняем в кэш
    monthProjectsSummaryCache[monthKey] = projects;
    
    return projects;
  } catch (error) {
    console.error('Ошибка загрузки сводки по проектам за месяц:', error);
    return [];
  }
}

// Построение HTML сводки по проектам за месяц
function buildMonthProjectsSummaryHTML(projects) {
  if (!projects || projects.length === 0) {
    return `
      <div class="month-projects-summary-container" style="margin-top: 24px; padding-top: 24px; border-top: 2px solid #eee;">
        <h4 style="margin-bottom: 12px;">📊 Сводка за месяц</h4>
        <p style="color: #666;">Нет данных по проектам за этот месяц</p>
      </div>
    `;
  }
  
  // Считаем общее количество часов
  const totalHours = projects.reduce((sum, project) => sum + (project.total_hours || 0), 0);
  
  let html = `
    <div class="month-projects-summary-container" style="margin-top: 24px; padding-top: 24px; border-top: 2px solid #eee;">
      <h4 style="margin-bottom: 12px;">📊 Сводка за месяц</h4>
      <p style="margin-bottom: 12px; color: #666; font-size: 14px;"><strong>Всего часов:</strong> ${totalHours.toFixed(1)}</p>
  `;
  
  projects.forEach(project => {
    html += `
      <div style="padding: 8px; margin-bottom: 6px; border: 1px solid #ddd; border-radius: 6px;">
        <p style="margin: 0; font-weight: 500;">${project.project_name}</p>
        <p style="margin: 4px 0 0 0; color: #666; font-size: 14px;">${(project.total_hours || 0).toFixed(1)} ч</p>
      </div>
    `;
  });
  
  html += '</div>';
  return html;
}

// Асинхронная загрузка сводки по проектам за месяц
async function loadMonthProjectsSummaryAsync(contentContainer, year, month) {
  const monthKey = getMonthKey(year, month);
  
  // Проверяем, не добавлена ли уже сводка
  if (contentContainer.querySelector('.month-projects-summary-container')) {
    return; // Уже добавлена
  }
  
  // Проверяем кэш
  let projects = monthProjectsSummaryCache[monthKey];
  
  if (!projects) {
    // Добавляем индикатор загрузки
    contentContainer.insertAdjacentHTML('beforeend', `
      <div class="month-projects-summary-loading" style="margin-top: 24px; padding-top: 24px; border-top: 2px solid #eee; text-align: center; color: #666;">
        <p style="margin: 0;">📊 Загрузка сводки за месяц...</p>
      </div>
    `);
    
    try {
      projects = await loadMonthProjectsSummary(year, month);
    } catch (error) {
      console.error('Ошибка загрузки сводки за месяц:', error);
      // Убираем индикатор загрузки
      const loadingIndicator = contentContainer.querySelector('.month-projects-summary-loading');
      if (loadingIndicator) {
        loadingIndicator.remove();
      }
      return;
    }
    
    // Убираем индикатор загрузки
    const loadingIndicator = contentContainer.querySelector('.month-projects-summary-loading');
    if (loadingIndicator) {
      loadingIndicator.remove();
    }
  }
  
  // Проверяем, что контейнер все еще существует и мы все еще на календаре
  if (!contentContainer || !contentContainer.querySelector('.dashboard-day')) {
    return; // Уже не на календаре
  }
  
  // Проверяем, не добавлена ли уже сводка (на случай параллельных загрузок)
  if (contentContainer.querySelector('.month-projects-summary-container')) {
    return; // Уже добавлена
  }
  
  // Добавляем сводку (данные уже в кэше или только что загружены)
  const summaryHTML = buildMonthProjectsSummaryHTML(projects);
  contentContainer.insertAdjacentHTML('beforeend', summaryHTML);
}

// Построение HTML календаря
function buildCalendarHTML(calendar, monthSummary, year, month) {
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const summary = monthSummary[monthKey] || {
    total_hours: 0,
    filled_days: 0,
    unfilled_days: 0,
    vacation_days: 0,
    sick_leave_days: 0,
    work_days: 0
  };
  
  let html = `
    <div style="margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px;">
        <button class="btn-alt" onclick="navigateMonth(-1)" style="padding: 6px 8px; font-size: 18px; width: 40px; flex-shrink: 0;">←</button>
        <h4 style="margin: 0; flex: 1; text-align: center;">${formatMonthYear(year, month + 1)}</h4>
        <button class="btn-alt" onclick="navigateMonth(1)" style="padding: 6px 8px; font-size: 18px; width: 40px; flex-shrink: 0;">→</button>
      </div>
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 12px;">
  `;
    
    // Заголовки дней недели
    const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekDays.forEach(day => {
      html += `<div style="padding: 8px; text-align: center; font-weight: bold; font-size: 12px; color: #666;">${day}</div>`;
    });
    
    // Получаем все дни месяца
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // getDay() возвращает 0 (воскресенье) - 6 (суббота), нам нужно понедельник = 0
    const firstDayOfWeekRaw = new Date(year, month, 1).getDay();
    const firstDayOfWeek = firstDayOfWeekRaw === 0 ? 6 : firstDayOfWeekRaw - 1; // Понедельник = 0
    
    // Пустые клетки до первого дня
    for (let i = 0; i < firstDayOfWeek; i++) {
      html += '<div style="padding: 8px;"></div>';
    }
    
    // Дни месяца
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayData = calendar[dateStr];
      
      let dayClass = 'dashboard-day';
      let dayContent = day;
      let dayTitle = '';
      
      if (dayData) {
        if (dayData.filled) {
          dayClass += ' filled';
          dayContent = `${day}<br><small>${dayData.total_hours.toFixed(1)}ч</small>`;
          dayTitle = `Заполнено: ${dayData.total_hours.toFixed(1)}ч, ${dayData.projects_count} проектов`;
        } else if (dayData.not_filled_reason) {
          dayClass += ' ' + dayData.not_filled_reason;
          dayContent = day;
          const reason = dayData.not_filled_reason === 'vacation' ? 'Отпуск' : 'Больничный';
          dayTitle = reason;
        } else {
          dayClass += ' unfilled';
          dayContent = day;
          dayTitle = 'Не заполнено';
        }
      } else {
        dayClass += ' empty';
        dayContent = day;
        dayTitle = 'Нет данных';
      }
      
      html += `
        <div class="${dayClass}" data-date="${dateStr}" title="${dayTitle}" style="
          padding: 8px;
          text-align: center;
          border: 1px solid #ddd;
          border-radius: 4px;
          cursor: ${dayData?.filled ? 'pointer' : 'default'};
          background: ${getDayBackgroundColor(dayData)};
          color: ${getDayTextColor(dayData)};
        ">
          ${dayContent}
        </div>
      `;
    }
    
    html += `
        </div>
        <div style="margin-bottom: 16px; padding: 12px; background: #f5f5f5; border-radius: 8px;">
          <p style="margin: 4px 0;"><strong>Всего часов:</strong> ${summary.total_hours.toFixed(1)}</p>
          <p style="margin: 4px 0;"><strong>Заполнено дней:</strong> ${summary.filled_days}</p>
          <p style="margin: 4px 0;"><strong>Незаполнено дней:</strong> ${summary.unfilled_days}</p>
          ${summary.vacation_days > 0 ? `<p style="margin: 4px 0;"><strong>Отпуск:</strong> ${summary.vacation_days} дней</p>` : ''}
          ${summary.sick_leave_days > 0 ? `<p style="margin: 4px 0;"><strong>Больничный:</strong> ${summary.sick_leave_days} дней</p>` : ''}
        </div>
      </div>
    `;
  
  return html;
}

// Навигация по месяцам
async function navigateMonth(direction) {
  // Изменяем месяц
  currentDashboardMonth.setMonth(currentDashboardMonth.getMonth() + direction);
  
  const newYear = currentDashboardMonth.getFullYear();
  const newMonth = currentDashboardMonth.getMonth();
  const newMonthKey = getMonthKey(newYear, newMonth);
  
  // Если данных нет в кэше, загружаем в фоне (не ждем)
  if (!calendarCache[newMonthKey]) {
    // Показываем календарь сразу (может быть с данными из предыдущего месяца или пустой)
    // и загружаем данные в фоне
    preloadMonths(newYear, newMonth, 3, 1).then(() => {
      // После загрузки перерисовываем календарь
      renderCalendar();
    });
    
    // Показываем календарь с загрузкой (если данных нет)
    const content = document.getElementById('dashboardContent');
    content.innerHTML = '<p class="loading-text">Загрузка...</p>';
    return;
  }
  
  // Перерисовываем календарь (данные уже в кэше - мгновенно)
  await renderCalendar();
}

// Экспортируем функцию для использования в onclick
window.navigateMonth = navigateMonth;

// Загрузка общей сводки по проектам (за все время)
async function loadProjectsSummary() {
  try {
    // Получаем список проектов из активных проектов пользователя (если доступен)
    // или собираем из нескольких дней календаря
    let projectIds = new Set();
    
    // Создаем маппинг project_id -> project_name из activeProjects
    const projectNamesMap = new Map();
    
    // Пробуем использовать активные проекты из глобальной области
    if (typeof activeProjects !== 'undefined' && Array.isArray(activeProjects) && activeProjects.length > 0) {
      activeProjects.forEach(project => {
        if (project.project_id) {
          projectIds.add(project.project_id);
          // Сохраняем название проекта для использования позже
          if (project.project_name) {
            projectNamesMap.set(project.project_id, project.project_name);
          } else if (project.name) {
            projectNamesMap.set(project.project_id, project.name);
          }
        }
      });
    }
    
    // Если не нашли проекты, собираем из месяцев статистики за последний год
    if (projectIds.size === 0) {
      const now = new Date();
      
      // Запрашиваем статистику за последние 12 месяцев
      const monthPromises = [];
      for (let i = 0; i < 12; i++) {
        const checkDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        monthPromises.push(
          fetch(`${API_BASE}/get-month-statistics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              telegram_id: parseInt(telegram_id),
              year: checkDate.getFullYear(),
              month: checkDate.getMonth() + 1
            })
          }).then(res => res.json()).catch(() => null)
        );
      }
      
      const monthsData = await Promise.all(monthPromises);
      
      monthsData.forEach(monthData => {
        if (monthData && monthData.projects && Array.isArray(monthData.projects)) {
          monthData.projects.forEach(project => {
            if (project.project_id) {
              projectIds.add(project.project_id);
              // Сохраняем название проекта, если есть
              if (project.project_name) {
                projectNamesMap.set(project.project_id, project.project_name);
              }
            }
          });
        }
      });
    }
    
    if (projectIds.size === 0) {
      return [];
    }
    
    // Запрашиваем timeline для каждого проекта параллельно (без фильтра по датам)
    const projectPromises = Array.from(projectIds).map(projectId => 
      fetch(`${API_BASE}/get-project-timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: parseInt(telegram_id),
          project_id: projectId
          // Не передаем start_date и end_date - получаем все данные
        })
      }).then(res => res.json()).then(data => {
        // Проверяем, что данные валидны
        if (!data || !data.project_id) {
          return null;
        }
        
        // Если нет project_name в ответе, используем из маппинга
        if (!data.project_name && projectNamesMap.has(projectId)) {
          data.project_name = projectNamesMap.get(projectId);
        }
        
        // Если всё ещё нет project_name, пропускаем проект
        if (!data.project_name) {
          return null;
        }
        
        return data;
      }).catch(() => {
        return null;
      })
    );
    
    const projectsData = await Promise.all(projectPromises);
    
    // Агрегируем данные: суммируем часы и дни из всех месяцев
    const summary = projectsData
      .filter(project => {
        // Фильтруем только валидные проекты с project_id и project_name
        return project !== null && 
               project.project_id && 
               project.project_name && 
               typeof project.project_name === 'string';
      })
      .map(project => {
        const totalHours = project.total_hours || 0;
        const totalDays = project.total_days || 0;
        const averagePerDay = totalDays > 0 ? totalHours / totalDays : 0;
        
        return {
          project_id: project.project_id,
          project_name: project.project_name,
          total_hours: totalHours,
          days_count: totalDays,
          average_per_day: averagePerDay,
          contracted_hours: project.contracted_hours || null,
          internal_hours: project.internal_hours || null
        };
      });
    
    // Сортируем по названию проекта (только если есть валидные проекты)
    if (summary.length > 0) {
      summary.sort((a, b) => {
        const nameA = a.project_name || '';
        const nameB = b.project_name || '';
        return nameA.localeCompare(nameB);
      });
    }
    
    return summary;
    
  } catch (error) {
    console.error('Ошибка загрузки сводки по проектам:', error);
    return [];
  }
}

// Построение HTML сводки по проектам
function buildProjectsSummaryHTML(projects) {
  let html = `
    <div class="projects-summary-container" style="margin-top: 24px; padding-top: 24px; border-top: 2px solid #eee;">
      <h4 style="margin-bottom: 12px;">📊 Сводка по проектам</h4>
  `;
  
  projects.forEach(project => {
    const hasPlan = project.contracted_hours !== null && project.contracted_hours !== undefined;
    const planHours = project.contracted_hours || 0;
    const factHours = project.total_hours || 0;
    const percentage = hasPlan && planHours > 0 ? Math.round((factHours / planHours) * 100) : null;
    
    html += `
      <div style="padding: 12px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 8px; cursor: pointer;" 
           onclick="renderProjectTimeline(${project.project_id})" 
           onmouseover="this.style.background='#f9f9f9'" 
           onmouseout="this.style.background='#fff'">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 4px;">
          <p style="margin: 0; font-weight: 600;">${project.project_name}</p>
          ${percentage !== null ? `<span style="font-size: 12px; color: ${percentage >= 100 ? '#e74c3c' : percentage >= 80 ? '#f39c12' : '#27ae60'};">
            ${percentage}%
          </span>` : ''}
        </div>
        <p style="margin: 4px 0; color: #666; font-size: 14px;">
          Факт: <strong>${factHours.toFixed(1)} ч</strong>
          ${hasPlan ? ` / План: <strong>${planHours} ч</strong>` : ''}
        </p>
        ${hasPlan ? `
          <div style="margin-top: 8px; height: 4px; background: #ecf0f1; border-radius: 2px; overflow: hidden;">
            <div style="height: 100%; background: ${percentage >= 100 ? '#e74c3c' : percentage >= 80 ? '#f39c12' : '#27ae60'}; width: ${Math.min(percentage, 100)}%; transition: width 0.3s ease;"></div>
          </div>
        ` : ''}
        <p style="margin: 4px 0 0 0; color: #999; font-size: 12px;">
          ${project.days_count} дней · среднее: ${project.average_per_day.toFixed(1)} ч/день
        </p>
      </div>
    `;
  });
  
  html += '</div>';
  return html;
}

// Настройка обработчиков кликов на проекты
function setupProjectClickHandlers() {
  // Обработчики уже установлены через onclick в HTML
}

// Настройка обработчиков навигации (для будущего использования)
function setupMonthNavigation() {
  // Обработчики уже установлены через onclick в HTML
}

// Получение цвета фона для дня
function getDayBackgroundColor(dayData) {
  if (!dayData) return '#f9f9f9';
  if (dayData.filled) return '#27ae60';
  if (dayData.not_filled_reason === 'vacation') return '#f39c12';
  if (dayData.not_filled_reason === 'sick_leave') return '#e74c3c';
  return '#ecf0f1';
}

// Получение цвета текста для дня
function getDayTextColor(dayData) {
  if (!dayData) return '#999';
  if (dayData.filled) return '#fff';
  if (dayData.not_filled_reason) return '#fff';
  return '#333';
}

// Настройка обработчиков кликов на дни
function setupDayClickHandlers() {
  document.querySelectorAll('.dashboard-day.filled').forEach(dayEl => {
    dayEl.addEventListener('click', async () => {
      const date = dayEl.dataset.date;
      await renderDayDetails(date);
    });
  });
}

// Рендеринг деталей дня
async function renderDayDetails(date) {
  const content = document.getElementById('dashboardContent');
  
  // Проверяем кэш
  let data = dayDetailsCache[date];
  
  if (data) {
    // Если данные есть в кэше, показываем сразу
    renderDayDetailsHTML(content, data, date);
    return;
  }
  
  // Если данных нет в кэше, показываем загрузку и загружаем
  content.innerHTML = '<p class="loading-text">Загрузка деталей...</p>';
  
  try {
    const response = await fetch(`${API_BASE}/get-day-details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: parseInt(telegram_id),
        date: date
      })
    });
    
    data = await response.json();
    // Сохраняем в кэш
    dayDetailsCache[date] = data;
    
    // Показываем данные
    renderDayDetailsHTML(content, data, date);
  } catch (error) {
    content.innerHTML = `<p style="color: #e74c3c;">❌ Ошибка загрузки деталей: ${error.message}</p>`;
  }
}

// Рендеринг HTML деталей дня (вынесено в отдельную функцию)
function renderDayDetailsHTML(content, data, date) {
  try {
    
    let html = `
      <div style="margin-bottom: 16px;">
        <button class="btn-alt" onclick="renderCalendar()" style="margin-bottom: 12px;">← Назад к календарю</button>
        <h4>Детали за ${formatDate(date)}</h4>
    `;
    
    if (data.filled) {
      html += `
        <div style="margin-bottom: 16px; padding: 12px; background: #f5f5f5; border-radius: 8px;">
          <p><strong>Всего часов:</strong> ${data.total_hours.toFixed(1)} (${Math.floor(data.total_minutes / 60)} ч ${data.total_minutes % 60} мин)</p>
        </div>
        <div>
          <h5>Записи по проектам:</h5>
      `;
      
      if (data.hours && data.hours.length > 0) {
        data.hours.forEach(entry => {
          html += `
            <div style="padding: 12px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 8px;">
              <p style="margin: 4px 0;"><strong>${entry.project_name}</strong></p>
              <p style="margin: 4px 0; color: #666;">${entry.hours} ч ${entry.minutes} мин (${entry.value.toFixed(2)} ч)</p>
            </div>
          `;
        });
      } else {
        html += '<p>Нет записей</p>';
      }
      
      html += '</div>';
    } else {
      const reason = data.not_filled_reason === 'vacation' ? 'Отпуск' : 
                     data.not_filled_reason === 'sick_leave' ? 'Больничный' : 
                     'Не заполнено';
      html += `
        <div style="padding: 12px; background: #ecf0f1; border-radius: 8px;">
          <p><strong>Статус:</strong> ${reason}</p>
        </div>
      `;
    }
    
    html += '</div>';
    content.innerHTML = html;
    
  } catch (error) {
    content.innerHTML = `<p style="color: #e74c3c;">❌ Ошибка загрузки деталей: ${error.message}</p>`;
  }
}

// Рендеринг статистики за месяц
async function renderMonthStatistics(year, month) {
  const content = document.getElementById('dashboardContent');
  
  content.innerHTML = '<p class="loading-text">Загрузка статистики...</p>';
  
  try {
    const response = await fetch(`${API_BASE}/get-month-statistics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: parseInt(telegram_id),
        year: year,
        month: month
      })
    });
    
    const data = await response.json();
    
    let html = `
      <div style="margin-bottom: 16px;">
        <button class="btn-alt" onclick="renderCalendar()" style="margin-bottom: 12px;">← Назад к календарю</button>
        <h4>Статистика за ${formatMonthYear(year, month)}</h4>
        <div style="margin-bottom: 16px; padding: 12px; background: #f5f5f5; border-radius: 8px;">
          <p><strong>Всего часов:</strong> ${data.total_hours.toFixed(1)}</p>
          <p><strong>Заполнено дней:</strong> ${data.filled_days}</p>
        </div>
        <div>
          <h5>По проектам:</h5>
    `;
    
    if (data.projects && data.projects.length > 0) {
      data.projects.forEach(project => {
        html += `
          <div style="padding: 12px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 8px; cursor: pointer;" 
               onclick="renderProjectTimeline(${project.project_id})">
            <p style="margin: 4px 0;"><strong>${project.project_name}</strong></p>
            <p style="margin: 4px 0; color: #666;">
              ${project.total_hours.toFixed(1)} ч за ${project.days_count} дней 
              (среднее: ${project.average_per_day.toFixed(1)} ч/день)
            </p>
            ${project.contracted_hours !== null ? `<p style="margin: 4px 0; color: #666; font-size: 12px;">План: ${project.contracted_hours} ч</p>` : ''}
          </div>
        `;
      });
    } else {
      html += '<p>Нет проектов</p>';
    }
    
    html += '</div></div>';
    content.innerHTML = html;
    
  } catch (error) {
    content.innerHTML = `<p style="color: #e74c3c;">❌ Ошибка загрузки статистики: ${error.message}</p>`;
  }
}

// Рендеринг таймлайна проекта
async function renderProjectTimeline(projectId) {
  const content = document.getElementById('dashboardContent');
  
  content.innerHTML = '<p class="loading-text">Загрузка таймлайна...</p>';
  
  try {
    const response = await fetch(`${API_BASE}/get-project-timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_id: parseInt(telegram_id),
        project_id: projectId
      })
    });
    
    const data = await response.json();
    
    let html = `
      <div style="margin-bottom: 16px;">
        <button class="btn-alt" onclick="renderCalendar()" style="margin-bottom: 12px;">← Назад к календарю</button>
        <h4>${data.project_name}</h4>
        <div style="margin-bottom: 16px; padding: 12px; background: #f5f5f5; border-radius: 8px;">
          <p><strong>Всего часов:</strong> ${data.total_hours.toFixed(1)}</p>
          <p><strong>Всего дней:</strong> ${data.total_days}</p>
          ${data.contracted_hours !== null ? `<p><strong>Контрактные часы:</strong> ${data.contracted_hours}</p>` : ''}
          ${data.internal_hours !== null ? `<p><strong>Внутренние часы:</strong> ${data.internal_hours}</p>` : ''}
        </div>
        <div>
          <h5>По месяцам:</h5>
    `;
    
    if (data.timeline && data.timeline.length > 0) {
      data.timeline.forEach(month => {
        html += `
          <div style="padding: 12px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 8px;">
            <p style="margin: 4px 0;"><strong>${formatMonthYear(month.year, month.month)}</strong></p>
            <p style="margin: 4px 0; color: #666;">
              ${month.total_hours.toFixed(1)} ч за ${month.days_count} дней 
              (среднее: ${month.average_per_day.toFixed(1)} ч/день)
            </p>
          </div>
        `;
      });
    } else {
      html += '<p>Нет данных</p>';
    }
    
    html += '</div></div>';
    content.innerHTML = html;
    
  } catch (error) {
    content.innerHTML = `<p style="color: #e74c3c;">❌ Ошибка загрузки таймлайна: ${error.message}</p>`;
  }
}

// Форматирование даты для API (YYYY-MM-DD)
function formatDateForAPI(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Форматирование месяца и года
function formatMonthYear(year, month) {
  const months = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];
  return `${months[month - 1]} ${year}`;
}

// Форматирование даты (использует функцию из index.html)
function formatDate(dateString) {
  if (typeof window.formatDate === 'function') {
    return window.formatDate(dateString);
  }
  // Fallback форматирование
  const date = new Date(dateString);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

// Экспортируем функции для использования в HTML
window.renderProjectTimeline = renderProjectTimeline;

