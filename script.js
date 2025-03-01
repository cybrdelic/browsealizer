// GitHub API endpoint for searching repositories
const GITHUB_API = 'https://api.github.com';

// API rate limiting and tracking
const apiTracker = {
    rateLimit: {
        limit: 60,        // Default GitHub API rate limit for unauthenticated requests
        remaining: 60,    // Remaining requests
        resetTime: null   // Time when the rate limit resets
    },
    requestCount: 0,      // Total requests made in this session
    requestLog: [],       // Log of recent API requests
    lastUpdated: null,    // Last time rate limit info was updated
    
    // Track API request
    trackRequest(url) {
        this.requestCount++;
        // Keep only the 10 most recent requests
        if (this.requestLog.length >= 10) {
            this.requestLog.shift();
        }
        this.requestLog.push({
            url: url,
            timestamp: new Date()
        });
    },
    
    // Update rate limit information from API response headers
    updateRateLimits(headers) {
        if (headers.get('x-ratelimit-limit')) {
            this.rateLimit.limit = parseInt(headers.get('x-ratelimit-limit'));
            this.rateLimit.remaining = parseInt(headers.get('x-ratelimit-remaining'));
            this.rateLimit.resetTime = new Date(parseInt(headers.get('x-ratelimit-reset')) * 1000);
            this.lastUpdated = new Date();
            
            // Update rate limit display
            updateRateLimitDisplay();
            
            // Warn user if rate limit is getting low
            if (this.rateLimit.remaining < 10) {
                showToast(`API rate limit getting low: ${this.rateLimit.remaining} requests remaining`, 'warning');
            }
        }
    },
    
    // Check if we're rate limited
    isRateLimited() {
        return this.rateLimit.remaining <= 0;
    },
    
    // Get time until rate limit reset
    getTimeUntilReset() {
        if (!this.rateLimit.resetTime) return 'unknown';
        
        const now = new Date();
        const diffMs = this.rateLimit.resetTime - now;
        
        if (diffMs <= 0) return 'soon';
        
        const diffMins = Math.floor(diffMs / 60000);
        const diffSecs = Math.floor((diffMs % 60000) / 1000);
        
        return `${diffMins}m ${diffSecs}s`;
    }
};

// App state
let state = {
    currentCategory: 'trending',
    currentTopic: null,
    currentPage: 1,
    totalPages: 1,
    itemsPerPage: 30,
    view: 'grid',
    sortBy: 'stars',
    language: '',
    minStars: 0,
    dateRange: '',
    darkMode: false,
    showRecommendations: true,
    recommendationFrequency: 10000,
    favorites: [],
    activeRepo: null,
    repoCache: {},
    recommendationQueue: [],
    currentPopupTimeout: null,
    isPopupVisible: false
};

// Load saved state from localStorage
function loadSavedState() {
    const savedState = localStorage.getItem('browsealizer_state');
    if (savedState) {
        try {
            const parsedState = JSON.parse(savedState);
            state = { ...state, ...parsedState };
            
            // Apply dark mode if it was enabled
            if (state.darkMode) {
                document.body.classList.add('dark-mode');
                document.getElementById('dark-mode-toggle').checked = true;
            }
            
            // Restore recommendation settings
            document.getElementById('recommendation-toggle').checked = state.showRecommendations;
            document.getElementById('popup-frequency').value = state.recommendationFrequency;
            
            // Apply view
            if (state.view === 'list') {
                document.getElementById('repositories-container').classList.remove('grid-view');
                document.getElementById('repositories-container').classList.add('list-view');
                document.getElementById('grid-view-btn').classList.remove('active');
                document.getElementById('list-view-btn').classList.add('active');
            }
            
            // Populate favorites
            renderFavorites();
        } catch (error) {
            console.error('Error loading saved state:', error);
        }
    }
}

// Save current state to localStorage
function saveState() {
    const stateToSave = {
        darkMode: state.darkMode,
        showRecommendations: state.showRecommendations,
        recommendationFrequency: state.recommendationFrequency,
        view: state.view,
        favorites: state.favorites
    };
    localStorage.setItem('browsealizer_state', JSON.stringify(stateToSave));
}

// DOM elements
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const filterButton = document.getElementById('filter-button');
const filtersPanel = document.getElementById('filters-panel');
const reposContainer = document.getElementById('repositories-container');
const loadingSpinner = document.getElementById('loading-spinner');
const paginationContainer = document.getElementById('pagination-container');
const recommendationPopup = document.getElementById('recommendation-popup');
const popupTitle = document.getElementById('popup-title');
const popupDescription = document.getElementById('popup-description');
const popupStats = document.getElementById('popup-stats');
const popupTags = document.getElementById('popup-tags');
const viewRepoBtn = document.getElementById('view-repo-btn');
const favoriteBtn = document.getElementById('favorite-btn');
const dismissBtn = document.getElementById('dismiss-btn');
const closeBtn = document.querySelector('.close-btn');
const contentTitle = document.getElementById('content-title');
const sidebarItems = document.querySelectorAll('.sidebar-list li[data-category]');
const topicItems = document.querySelectorAll('.sidebar-list li[data-topic]');
const gridViewBtn = document.getElementById('grid-view-btn');
const listViewBtn = document.getElementById('list-view-btn');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const pageNumbers = document.getElementById('page-numbers');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const recommendationToggle = document.getElementById('recommendation-toggle');
const popupFrequency = document.getElementById('popup-frequency');
const favoritesContainer = document.getElementById('favorites-container');
const repoDetailModal = document.getElementById('repo-detail-modal');
const modalCloseBtn = document.querySelector('.modal-close-btn');
const toastContainer = document.getElementById('toast-container');
const starsFilter = document.getElementById('stars-filter');
const starsValue = document.getElementById('stars-value');
const languageFilter = document.getElementById('language-filter');
const sortFilter = document.getElementById('sort-filter');
const dateFilter = document.getElementById('date-filter');
const applyFiltersBtn = document.getElementById('apply-filters');
const resetFiltersBtn = document.getElementById('reset-filters');

// DOM loaded event to make sure all elements are available
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded");
    
    // Event listeners for basic functionality
    searchButton.addEventListener('click', handleSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
    closeBtn.addEventListener('click', hideRecommendation);
    viewRepoBtn.addEventListener('click', () => {
        if (viewRepoBtn.dataset.url) {
            window.open(viewRepoBtn.dataset.url, '_blank');
        }
    });
    favoriteBtn.addEventListener('click', () => addToFavorites(state.activeRepo));
    dismissBtn.addEventListener('click', hideRecommendation);
    
    // Attach event listeners for all sidebar items
    Array.from(sidebarItems).forEach(item => {
        console.log("Attaching click to sidebar item:", item.dataset.category);
        item.addEventListener('click', function() {
            console.log("Sidebar item clicked:", this.dataset.category);
            
            // Remove active class from all items
            sidebarItems.forEach(i => i.classList.remove('active'));
            topicItems.forEach(i => i.classList.remove('active'));
            
            // Add active class to clicked item
            this.classList.add('active');
            
            // Update state
            state.currentCategory = this.dataset.category;
            state.currentTopic = null;
            state.currentPage = 1;
            
            // Update content title
            contentTitle.textContent = this.textContent.trim();
            
            // Load repositories for the selected category
            loadRepositories();
        });
    });
    
    // Attach event listeners for all topic items
    Array.from(topicItems).forEach(item => {
        console.log("Attaching click to topic item:", item.dataset.topic);
        item.addEventListener('click', function() {
            console.log("Topic item clicked:", this.dataset.topic);
            
            // Remove active class from all items
            sidebarItems.forEach(i => i.classList.remove('active'));
            topicItems.forEach(i => i.classList.remove('active'));
            
            // Add active class to clicked item
            this.classList.add('active');
            
            // Update state
            state.currentCategory = null;
            state.currentTopic = this.dataset.topic;
            state.currentPage = 1;
            
            // Update content title
            contentTitle.textContent = this.textContent.trim() + ' Repositories';
            
            // Load repositories for the selected topic
            loadRepositories();
        });
    });
    
    // Add toggle listeners for dark mode and recommendations
    darkModeToggle.addEventListener('click', () => {
        state.darkMode = darkModeToggle.checked;
        if (state.darkMode) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        saveState();
        console.log("Dark mode toggled:", state.darkMode);
    });
    
    recommendationToggle.addEventListener('click', () => {
        state.showRecommendations = recommendationToggle.checked;
        saveState();
        
        if (!state.showRecommendations) {
            hideRecommendation();
        } else if (state.recommendationQueue.length > 0) {
            showNextRecommendation();
        } else {
            generateRecommendations();
        }
        console.log("Recommendations toggled:", state.showRecommendations);
    });
});

// Event listeners for filter panel
filterButton.addEventListener('click', () => {
    filtersPanel.classList.toggle('hidden');
});

// Apply filters
applyFiltersBtn.addEventListener('click', () => {
    state.language = languageFilter.value;
    state.sortBy = sortFilter.value;
    state.dateRange = dateFilter.value;
    state.minStars = parseInt(starsFilter.value);
    filtersPanel.classList.add('hidden');
    state.currentPage = 1;
    loadRepositories();
});

// Reset filters
resetFiltersBtn.addEventListener('click', () => {
    languageFilter.value = '';
    sortFilter.value = 'stars';
    dateFilter.value = '';
    starsFilter.value = 0;
    starsValue.textContent = '0';
    state.language = '';
    state.sortBy = 'stars';
    state.dateRange = '';
    state.minStars = 0;
    filtersPanel.classList.add('hidden');
    state.currentPage = 1;
    loadRepositories();
});

// Update stars value display
starsFilter.addEventListener('input', () => {
    starsValue.textContent = starsFilter.value;
});

// These are moved to the DOMContentLoaded event now

// View switching (grid/list)
gridViewBtn.addEventListener('click', () => {
    if (state.view !== 'grid') {
        state.view = 'grid';
        reposContainer.classList.remove('list-view');
        reposContainer.classList.add('grid-view');
        gridViewBtn.classList.add('active');
        listViewBtn.classList.remove('active');
        saveState();
    }
});

listViewBtn.addEventListener('click', () => {
    if (state.view !== 'list') {
        state.view = 'list';
        reposContainer.classList.remove('grid-view');
        reposContainer.classList.add('list-view');
        gridViewBtn.classList.remove('active');
        listViewBtn.classList.add('active');
        saveState();
    }
});

// Pagination
prevPageBtn.addEventListener('click', () => {
    if (state.currentPage > 1) {
        state.currentPage--;
        loadRepositories(false);
    }
});

nextPageBtn.addEventListener('click', () => {
    if (state.currentPage < state.totalPages) {
        state.currentPage++;
        loadRepositories(false);
    }
});

// These settings event listeners are also moved to DOMContentLoaded

popupFrequency.addEventListener('change', () => {
    state.recommendationFrequency = parseInt(popupFrequency.value);
    saveState();
});

// Modal close button
modalCloseBtn.addEventListener('click', () => {
    repoDetailModal.classList.remove('visible');
    setTimeout(() => {
        repoDetailModal.classList.add('hidden');
    }, 300);
});

// Analytics tracking function
function trackEvent(eventName, eventData = {}) {
    const trackingData = {
        event: eventName,
        timestamp: new Date().toISOString(),
        page: window.location.pathname,
        ...eventData
    };
    
    console.log('Analytics event:', trackingData);
    
    // In a real app, you would send this to your analytics service
    // Example: fetch('/api/analytics', { method: 'POST', body: JSON.stringify(trackingData) });
    
    // Store locally for this session
    if (!window.analyticsEvents) {
        window.analyticsEvents = [];
    }
    window.analyticsEvents.push(trackingData);
}

// Update the rate limit display in the UI
function updateRateLimitDisplay() {
    const rateLimitElement = document.getElementById('rate-limit-display');
    if (rateLimitElement) {
        const resetTime = apiTracker.getTimeUntilReset();
        
        // Add warning class if remaining requests are low
        const warningClass = apiTracker.rateLimit.remaining < 10 ? ' warning' : '';
        
        // Update the display with current rate limit info
        rateLimitElement.innerHTML = `
            <div class="rate-limit-count${warningClass}">
                ${apiTracker.rateLimit.remaining}/${apiTracker.rateLimit.limit}
            </div>
            <div class="rate-limit-reset">
                Reset: ${resetTime}
            </div>
        `;
        
        // Add title attribute for tooltip
        rateLimitElement.title = `GitHub API Rate Limit: ${apiTracker.rateLimit.remaining} of ${apiTracker.rateLimit.limit} requests remaining. Resets in ${resetTime}.`;
        
        // Make clickable to show rate limit info toast
        rateLimitElement.style.cursor = 'pointer';
        rateLimitElement.onclick = () => {
            showToast(`GitHub API rate limit: ${apiTracker.rateLimit.remaining}/${apiTracker.rateLimit.limit}. Resets in ${resetTime}.`, 'info');
            
            // Show more detailed info in console
            console.log('API usage stats:', {
                rateLimit: apiTracker.rateLimit,
                totalRequests: apiTracker.requestCount,
                recentRequests: apiTracker.requestLog
            });
        };
    }
}

// Initialize with popular repositories
window.addEventListener('DOMContentLoaded', () => {
    loadSavedState();
    
    // Initial analytics tracking
    trackEvent('app_loaded', {
        dark_mode: state.darkMode,
        view_mode: state.view
    });
    
    // Check current API rate limit
    fetch(`${GITHUB_API}/rate_limit`)
        .then(response => {
            apiTracker.updateRateLimits(response.headers);
            return response.json();
        })
        .then(data => {
            console.log('Rate limit info:', data);
            if (data.resources && data.resources.core) {
                apiTracker.rateLimit.limit = data.resources.search.limit;
                apiTracker.rateLimit.remaining = data.resources.search.remaining;
                apiTracker.rateLimit.resetTime = new Date(data.resources.search.reset * 1000);
                apiTracker.lastUpdated = new Date();
                updateRateLimitDisplay();
            }
        })
        .catch(error => {
            console.error('Error fetching rate limit:', error);
        });
    
    loadRepositories();
    startRecommendationCycle();
    
    // Tab switching in repository detail modal
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all tabs
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            
            // Add active class to clicked tab
            btn.classList.add('active');
            document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
        });
    });
});

// Search for repositories
async function handleSearch() {
    const query = searchInput.value.trim();
    if (!query) return;
    
    state.currentCategory = null;
    state.currentTopic = null;
    state.currentPage = 1;
    contentTitle.textContent = `Search Results for "${query}"`;
    
    // Remove active class from all sidebar items
    sidebarItems.forEach(i => i.classList.remove('active'));
    topicItems.forEach(i => i.classList.remove('active'));
    
    loadRepositories(true, query);
}

// Load repositories based on current state
async function loadRepositories(resetPage = true, searchQuery = null) {
    if (resetPage) {
        state.currentPage = 1;
    }
    
    showLoading();
    console.log("Loading repos with topic:", state.currentTopic, "category:", state.currentCategory);
    
    // Check if we're rate limited
    if (apiTracker.isRateLimited()) {
        const resetTime = apiTracker.getTimeUntilReset();
        showToast(`GitHub API rate limit exceeded. Try again in ${resetTime}.`, 'error');
        reposContainer.innerHTML = `
            <div class="rate-limit-error">
                <i class="fas fa-exclamation-circle"></i>
                <h3>API Rate Limit Exceeded</h3>
                <p>GitHub API limits unauthenticated requests to ${apiTracker.rateLimit.limit} per hour.</p>
                <p>Rate limit will reset in ${resetTime}.</p>
                <p>Please try again later.</p>
            </div>
        `;
        hideLoading();
        return;
    }

    try {
        let endpoint = `${GITHUB_API}/search/repositories?`;
        let queryParams = [];
        
        if (searchQuery) {
            // Search query
            queryParams.push(`q=${encodeURIComponent(searchQuery)}`);
            console.log("Search query:", searchQuery);
        } else if (state.currentTopic) {
            // Topic query
            queryParams.push(`q=topic:${encodeURIComponent(state.currentTopic)}`);
            console.log("Using topic:", state.currentTopic);
        } else {
            // Category query
            switch(state.currentCategory) {
                case 'trending':
                    const oneMonthAgo = new Date();
                    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
                    const dateStr = oneMonthAgo.toISOString().split('T')[0];
                    queryParams.push(`q=created:>${dateStr}`);
                    break;
                case 'stars':
                    queryParams.push('q=stars:>5000');
                    break;
                case 'recent':
                    const oneWeekAgo = new Date();
                    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
                    const recentDateStr = oneWeekAgo.toISOString().split('T')[0];
                    queryParams.push(`q=pushed:>${recentDateStr}`);
                    break;
                case 'recommendations':
                    // Use a mix of popular repositories from different domains
                    queryParams.push('q=stars:>1000');
                    break;
                default:
                    queryParams.push('q=stars:>1000');
            }
            console.log("Using category:", state.currentCategory);
        }
        
        // Add filters
        if (state.language) {
            queryParams[0] += `+language:${encodeURIComponent(state.language)}`;
        }
        
        if (state.minStars > 0) {
            queryParams[0] += `+stars:>=${state.minStars}`;
        }
        
        if (state.dateRange) {
            const now = new Date();
            let dateStr = '';
            
            switch(state.dateRange) {
                case 'daily':
                    dateStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
                    break;
                case 'weekly':
                    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    dateStr = `${lastWeek.getFullYear()}-${(lastWeek.getMonth() + 1).toString().padStart(2, '0')}-${lastWeek.getDate().toString().padStart(2, '0')}`;
                    break;
                case 'monthly':
                    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                    dateStr = `${lastMonth.getFullYear()}-${(lastMonth.getMonth() + 1).toString().padStart(2, '0')}-${lastMonth.getDate().toString().padStart(2, '0')}`;
                    break;
                case 'yearly':
                    dateStr = `${now.getFullYear() - 1}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
                    break;
            }
            
            if (dateStr) {
                queryParams[0] += `+created:>${dateStr}`;
            }
        }
        
        // Add sort parameter
        queryParams.push(`sort=${state.sortBy}`);
        queryParams.push('order=desc');
        
        // Add pagination
        queryParams.push(`page=${state.currentPage}`);
        queryParams.push(`per_page=${state.itemsPerPage}`);
        
        // Construct final URL
        const url = endpoint + queryParams.join('&');
        
        // Track this API request
        apiTracker.trackRequest(url);
        
        // Make the API request with a timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            // Update rate limits from response headers
            apiTracker.updateRateLimits(response.headers);
            
            const data = await response.json();
            
            if (data.items && data.items.length > 0) {
                // Calculate total pages
                state.totalPages = Math.min(Math.ceil(data.total_count / state.itemsPerPage), 34); // GitHub API limits to 1000 results (34 pages of 30 items)
                
                // Cache repositories
                data.items.forEach(repo => {
                    state.repoCache[repo.id] = repo;
                });
                
                // Display repositories
                displayRepositories(data.items);
                
                // Update pagination
                updatePagination();
                
                // Generate recommendations
                generateRecommendations(data.items);
                
                // Analytics tracking
                trackEvent('search_results', {
                    query: searchQuery || state.currentTopic || state.currentCategory,
                    result_count: data.items.length,
                    total_count: data.total_count
                });
            } else {
                reposContainer.innerHTML = '<p class="no-results">No repositories found.</p>';
                paginationContainer.classList.add('hidden');
                
                // Analytics tracking for no results
                trackEvent('search_no_results', {
                    query: searchQuery || state.currentTopic || state.currentCategory
                });
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                reposContainer.innerHTML = '<p class="no-results">Request timed out. Please try again later.</p>';
                showToast('Request timed out. Please try again.', 'error');
            } else {
                throw error; // Re-throw for the outer catch block
            }
        }
    } catch (error) {
        console.error('Error fetching repositories:', error);
        reposContainer.innerHTML = '<p class="no-results">Failed to fetch repositories. Please try again later.</p>';
        paginationContainer.classList.add('hidden');
    }
    
    hideLoading();
}

// Show loading spinner
function showLoading() {
    reposContainer.innerHTML = '';
    loadingSpinner.classList.remove('hidden');
    paginationContainer.classList.add('hidden');
}

// Hide loading spinner
function hideLoading() {
    loadingSpinner.classList.add('hidden');
}

// Update pagination UI
function updatePagination() {
    if (state.totalPages <= 1) {
        paginationContainer.classList.add('hidden');
        return;
    }
    
    paginationContainer.classList.remove('hidden');
    prevPageBtn.disabled = state.currentPage === 1;
    nextPageBtn.disabled = state.currentPage === state.totalPages;
    
    // Update page numbers
    pageNumbers.innerHTML = '';
    
    const maxPageButtons = 5;
    let startPage = Math.max(1, state.currentPage - Math.floor(maxPageButtons / 2));
    let endPage = Math.min(state.totalPages, startPage + maxPageButtons - 1);
    
    if (endPage - startPage + 1 < maxPageButtons) {
        startPage = Math.max(1, endPage - maxPageButtons + 1);
    }
    
    if (startPage > 1) {
        addPageButton(1);
        if (startPage > 2) {
            addEllipsis();
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        addPageButton(i);
    }
    
    if (endPage < state.totalPages) {
        if (endPage < state.totalPages - 1) {
            addEllipsis();
        }
        addPageButton(state.totalPages);
    }
}

// Add a page button to pagination
function addPageButton(pageNum) {
    const pageButton = document.createElement('div');
    pageButton.className = 'page-number' + (pageNum === state.currentPage ? ' active' : '');
    pageButton.textContent = pageNum;
    pageButton.addEventListener('click', () => {
        if (pageNum !== state.currentPage) {
            state.currentPage = pageNum;
            loadRepositories(false);
        }
    });
    pageNumbers.appendChild(pageButton);
}

// Add ellipsis to pagination
function addEllipsis() {
    const ellipsis = document.createElement('div');
    ellipsis.className = 'page-ellipsis';
    ellipsis.textContent = '...';
    pageNumbers.appendChild(ellipsis);
}

// Display repositories in the UI
function displayRepositories(repositories) {
    reposContainer.innerHTML = '';
    
    repositories.forEach(repo => {
        const repoCard = document.createElement('div');
        repoCard.className = 'repo-card';
        repoCard.dataset.id = repo.id;
        
        // Generate tags
        const tags = [];
        if (repo.language) {
            tags.push(repo.language);
        }
        if (repo.license && repo.license.name) {
            tags.push(repo.license.name);
        }
        if (repo.topics && repo.topics.length > 0) {
            tags.push(...repo.topics.slice(0, 3));
        }
        
        const tagsHtml = tags.length > 0
            ? `<div class="tag-container">
                ${tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
               </div>`
            : '';
        
        repoCard.innerHTML = `
            <h2 class="repo-title">
                <a href="${repo.html_url}" target="_blank">${repo.full_name}</a>
            </h2>
            <p class="repo-description">${repo.description || 'No description available'}</p>
            ${tagsHtml}
            <div class="repo-stats">
                <span><i class="fas fa-star"></i> ${repo.stargazers_count.toLocaleString()}</span>
                <span><i class="fas fa-code-branch"></i> ${repo.forks_count.toLocaleString()}</span>
                <span><i class="fas fa-eye"></i> ${repo.watchers_count.toLocaleString()}</span>
                <span><i class="fas fa-history"></i> ${formatDate(repo.updated_at)}</span>
            </div>
        `;
        
        // Add click handler to open repo details
        repoCard.addEventListener('click', () => openRepoDetails(repo));
        
        reposContainer.appendChild(repoCard);
    });
}

// Format date for display
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
        return 'Today';
    } else if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays < 7) {
        return `${diffDays} days ago`;
    } else if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    } else if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    } else {
        const years = Math.floor(diffDays / 365);
        return `${years} ${years === 1 ? 'year' : 'years'} ago`;
    }
}

// Open repository details modal
async function openRepoDetails(repo) {
    // Set the active repo
    state.activeRepo = repo;
    
    // Track analytics event
    trackEvent('view_repository_details', {
        repo_id: repo.id,
        repo_name: repo.full_name,
        repo_stars: repo.stargazers_count,
        repo_language: repo.language || 'none'
    });
    
    // Update modal content
    document.getElementById('modal-title').textContent = repo.full_name;
    document.getElementById('modal-description').textContent = repo.description || 'No description available';
    document.getElementById('modal-repo-link').href = repo.html_url;
    
    // Set favorite button icon based on whether this repo is in favorites
    const modalFavoriteBtn = document.getElementById('modal-favorite-btn');
    const isFavorite = state.favorites.some(fav => fav.id === repo.id);
    modalFavoriteBtn.innerHTML = isFavorite
        ? '<i class="fas fa-heart"></i> Remove from Favorites'
        : '<i class="far fa-heart"></i> Add to Favorites';
    
    // Add favorite button handler
    modalFavoriteBtn.onclick = () => {
        if (isFavorite) {
            removeFromFavorites(repo);
            modalFavoriteBtn.innerHTML = '<i class="far fa-heart"></i> Add to Favorites';
            showToast('Repository removed from favorites', 'success');
        } else {
            addToFavorites(repo);
            modalFavoriteBtn.innerHTML = '<i class="fas fa-heart"></i> Remove from Favorites';
            showToast('Repository added to favorites', 'success');
        }
    };
    
    // Add share button handler
    document.getElementById('modal-share-btn').onclick = () => {
        // Use Web Share API if available
        if (navigator.share) {
            navigator.share({
                title: repo.full_name,
                text: repo.description,
                url: repo.html_url
            }).catch(err => {
                console.error('Error sharing:', err);
                copyToClipboard(repo.html_url);
                showToast('Repository URL copied to clipboard', 'success');
            });
        } else {
            copyToClipboard(repo.html_url);
            showToast('Repository URL copied to clipboard', 'success');
        }
    };
    
    // Add repository metadata
    const metaContainer = document.getElementById('modal-meta');
    metaContainer.innerHTML = `
        <div class="repo-meta-item"><i class="fas fa-star"></i> ${repo.stargazers_count.toLocaleString()} stars</div>
        <div class="repo-meta-item"><i class="fas fa-code-branch"></i> ${repo.forks_count.toLocaleString()} forks</div>
        <div class="repo-meta-item"><i class="fas fa-eye"></i> ${repo.watchers_count.toLocaleString()} watchers</div>
        <div class="repo-meta-item"><i class="fas fa-code"></i> ${repo.language || 'Not specified'}</div>
        <div class="repo-meta-item"><i class="fas fa-exclamation-circle"></i> ${repo.open_issues_count.toLocaleString()} issues</div>
        <div class="repo-meta-item"><i class="fas fa-history"></i> Updated ${formatDate(repo.updated_at)}</div>
    `;
    
    // Add tags
    const tagsContainer = document.getElementById('modal-tags');
    tagsContainer.innerHTML = '';
    
    if (repo.license && repo.license.name) {
        const licenseTag = document.createElement('span');
        licenseTag.className = 'tag';
        licenseTag.innerHTML = `<i class="fas fa-balance-scale"></i> ${repo.license.name}`;
        tagsContainer.appendChild(licenseTag);
    }
    
    if (repo.topics && repo.topics.length > 0) {
        repo.topics.forEach(topic => {
            const topicTag = document.createElement('span');
            topicTag.className = 'tag';
            topicTag.textContent = topic;
            tagsContainer.appendChild(topicTag);
        });
    }
    
    // Reset tabs
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    document.querySelector('.tab-btn[data-tab="readme"]').classList.add('active');
    document.getElementById('readme-tab').classList.add('active');
    
    // Load README content
    loadReadme(repo);
    
    // Load statistics
    loadStats(repo);
    
    // Load issues
    loadIssues(repo);
    
    // Load contributors
    loadContributors(repo);
    
    // Show the modal
    repoDetailModal.classList.remove('hidden');
    setTimeout(() => {
        repoDetailModal.classList.add('visible');
    }, 50);
}

// Load README content
async function loadReadme(repo) {
    const readmeTab = document.getElementById('readme-tab');
    readmeTab.innerHTML = '<div class="readme-placeholder"><div class="spinner"></div><p>Loading README...</p></div>';
    
    try {
        const response = await fetch(`${GITHUB_API}/repos/${repo.full_name}/readme`);
        if (response.status === 404) {
            readmeTab.innerHTML = '<div class="readme-content"><p>No README file found in this repository.</p></div>';
            return;
        }
        
        const data = await response.json();
        
        if (data.content) {
            // Decode base64 content
            const decoded = atob(data.content);
            // Convert markdown to HTML
            const html = marked.parse(decoded);
            readmeTab.innerHTML = `<div class="readme-content">${html}</div>`;
        } else {
            readmeTab.innerHTML = '<div class="readme-content"><p>Failed to load README file.</p></div>';
        }
    } catch (error) {
        console.error('Error fetching README:', error);
        readmeTab.innerHTML = '<div class="readme-content"><p>Failed to load README file.</p></div>';
    }
}

// Load repository statistics
async function loadStats(repo) {
    const statsTab = document.getElementById('stats-tab');
    const statsInfo = document.getElementById('stats-info');
    
    statsInfo.innerHTML = '';
    
    // Add basic stats
    const statsItemCreated = document.createElement('div');
    statsItemCreated.className = 'stats-info-item';
    statsItemCreated.innerHTML = `
        <h4>Repository Age</h4>
        <p>Created on ${new Date(repo.created_at).toLocaleDateString()} (${formatDate(repo.created_at)})</p>
    `;
    statsInfo.appendChild(statsItemCreated);
    
    const statsItemSize = document.createElement('div');
    statsItemSize.className = 'stats-info-item';
    statsItemSize.innerHTML = `
        <h4>Repository Size</h4>
        <p>${formatSize(repo.size * 1024)}</p>
    `;
    statsInfo.appendChild(statsItemSize);
    
    const statsItemDefault = document.createElement('div');
    statsItemDefault.className = 'stats-info-item';
    statsItemDefault.innerHTML = `
        <h4>Default Branch</h4>
        <p>${repo.default_branch}</p>
    `;
    statsInfo.appendChild(statsItemDefault);
    
    try {
        // Fetch commit activity
        const commitActivityResponse = await fetch(`${GITHUB_API}/repos/${repo.full_name}/stats/commit_activity`);
        const commitActivityData = await commitActivityResponse.json();
        
        if (Array.isArray(commitActivityData) && commitActivityData.length > 0) {
            // Prepare data for chart
            const labels = [];
            const data = [];
            
            // Get last 12 weeks
            const recentActivity = commitActivityData.slice(-12);
            
            recentActivity.forEach(week => {
                const date = new Date(week.week * 1000);
                labels.push(`Week of ${date.toLocaleDateString()}`);
                data.push(week.total);
            });
            
            // Create chart
            const ctx = document.getElementById('commit-activity-chart').getContext('2d');
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Commits',
                        data: data,
                        backgroundColor: '#2ea44f',
                        borderColor: '#2ea44f',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Number of Commits'
                            }
                        }
                    }
                }
            });
            
            // Add commit stats info
            const totalCommits = data.reduce((a, b) => a + b, 0);
            const statsItemCommits = document.createElement('div');
            statsItemCommits.className = 'stats-info-item';
            statsItemCommits.innerHTML = `
                <h4>Recent Activity</h4>
                <p>${totalCommits} commits in the last 12 weeks</p>
            `;
            statsInfo.appendChild(statsItemCommits);
        }
    } catch (error) {
        console.error('Error fetching commit activity:', error);
        document.getElementById('commit-activity-chart').innerHTML = '<p>Failed to load commit activity data.</p>';
    }
}

// Format file size
function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Load repository issues
async function loadIssues(repo) {
    const issuesList = document.getElementById('issues-list');
    issuesList.innerHTML = '<div class="spinner"></div><p>Loading issues...</p>';
    
    try {
        const response = await fetch(`${GITHUB_API}/repos/${repo.full_name}/issues?state=open&per_page=5`);
        const issues = await response.json();
        
        if (Array.isArray(issues) && issues.length > 0) {
            issuesList.innerHTML = '';
            
            issues.forEach(issue => {
                const issueItem = document.createElement('div');
                issueItem.className = 'issue-item';
                
                // Create labels HTML
                let labelsHtml = '';
                if (issue.labels && issue.labels.length > 0) {
                    labelsHtml = '<div class="issue-labels">';
                    issue.labels.forEach(label => {
                        const bgColor = `#${label.color}`;
                        const textColor = getContrastYIQ(label.color);
                        labelsHtml += `<span class="issue-label" style="background-color: ${bgColor}; color: ${textColor};">${label.name}</span>`;
                    });
                    labelsHtml += '</div>';
                }
                
                issueItem.innerHTML = `
                    <div class="issue-content">
                        <h3 class="issue-title">
                            <a href="${issue.html_url}" target="_blank">${issue.title}</a>
                        </h3>
                        <div class="issue-meta">
                            <span><i class="fas fa-exclamation-circle"></i> #${issue.number}</span>
                            <span><i class="fas fa-user"></i> ${issue.user.login}</span>
                            <span><i class="fas fa-clock"></i> Opened ${formatDate(issue.created_at)}</span>
                            <span><i class="fas fa-comment"></i> ${issue.comments} comments</span>
                        </div>
                        ${labelsHtml}
                    </div>
                `;
                
                issuesList.appendChild(issueItem);
            });
            
            // Add view all issues link
            const viewAllLink = document.createElement('a');
            viewAllLink.href = `${repo.html_url}/issues`;
            viewAllLink.target = '_blank';
            viewAllLink.className = 'primary-btn';
            viewAllLink.style.marginTop = '1rem';
            viewAllLink.style.display = 'inline-block';
            viewAllLink.innerHTML = '<i class="fas fa-external-link-alt"></i> View All Issues';
            issuesList.appendChild(viewAllLink);
        } else {
            issuesList.innerHTML = '<p>No open issues found in this repository.</p>';
        }
    } catch (error) {
        console.error('Error fetching issues:', error);
        issuesList.innerHTML = '<p>Failed to load issues.</p>';
    }
}

// Load repository contributors
async function loadContributors(repo) {
    const contributorsList = document.getElementById('contributors-list');
    contributorsList.innerHTML = '<div class="spinner"></div><p>Loading contributors...</p>';
    
    try {
        const response = await fetch(`${GITHUB_API}/repos/${repo.full_name}/contributors?per_page=10`);
        const contributors = await response.json();
        
        if (Array.isArray(contributors) && contributors.length > 0) {
            contributorsList.innerHTML = '';
            
            contributors.forEach(contributor => {
                const contributorItem = document.createElement('div');
                contributorItem.className = 'contributor-item';
                
                contributorItem.innerHTML = `
                    <div class="contributor-avatar">
                        <img src="${contributor.avatar_url}" alt="${contributor.login}">
                    </div>
                    <div class="contributor-content">
                        <h3 class="contributor-name">
                            <a href="${contributor.html_url}" target="_blank">${contributor.login}</a>
                        </h3>
                        <div class="contributor-meta">
                            <span><i class="fas fa-code-commit"></i> ${contributor.contributions} contributions</span>
                        </div>
                    </div>
                `;
                
                contributorsList.appendChild(contributorItem);
            });
            
            // Add view all contributors link
            const viewAllLink = document.createElement('a');
            viewAllLink.href = `${repo.html_url}/graphs/contributors`;
            viewAllLink.target = '_blank';
            viewAllLink.className = 'primary-btn';
            viewAllLink.style.marginTop = '1rem';
            viewAllLink.style.display = 'inline-block';
            viewAllLink.innerHTML = '<i class="fas fa-external-link-alt"></i> View All Contributors';
            contributorsList.appendChild(viewAllLink);
        } else {
            contributorsList.innerHTML = '<p>No contributors found in this repository.</p>';
        }
    } catch (error) {
        console.error('Error fetching contributors:', error);
        contributorsList.innerHTML = '<p>Failed to load contributors.</p>';
    }
}

// Get contrast color for text based on background
function getContrastYIQ(hexcolor) {
    // If hexcolor doesn't start with #, add it
    if (!hexcolor.startsWith('#')) {
        hexcolor = `#${hexcolor}`;
    }
    
    // Convert hex to RGB
    const r = parseInt(hexcolor.substr(1, 2), 16);
    const g = parseInt(hexcolor.substr(3, 2), 16);
    const b = parseInt(hexcolor.substr(5, 2), 16);
    
    // Calculate contrast
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    
    // Return black or white text color based on contrast
    return (yiq >= 128) ? 'black' : 'white';
}

// Copy text to clipboard
function copyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
}

// Add to favorites
function addToFavorites(repo) {
    if (!repo) return;
    
    // Check if already in favorites
    if (!state.favorites.some(fav => fav.id === repo.id)) {
        // Add simplified version of repo to favorites
        state.favorites.push({
            id: repo.id,
            name: repo.full_name,
            url: repo.html_url,
            addedAt: new Date().toISOString(),
            language: repo.language,
            stars: repo.stargazers_count
        });
        
        saveState();
        renderFavorites();
        showToast('Repository added to favorites', 'success');
        
        // Track analytics
        trackEvent('add_favorite', {
            repo_id: repo.id,
            repo_name: repo.full_name,
            total_favorites: state.favorites.length
        });
    }
}

// Remove from favorites
function removeFromFavorites(repo) {
    if (!repo) return;
    
    // Find the repo in favorites for analytics
    const repoToRemove = state.favorites.find(fav => fav.id === repo.id);
    
    state.favorites = state.favorites.filter(fav => fav.id !== repo.id);
    saveState();
    renderFavorites();
    
    // Track analytics
    if (repoToRemove) {
        trackEvent('remove_favorite', {
            repo_id: repoToRemove.id,
            repo_name: repoToRemove.name,
            total_favorites: state.favorites.length
        });
    }
}

// Render favorites in sidebar
function renderFavorites() {
    favoritesContainer.innerHTML = '';
    
    if (state.favorites.length === 0) {
        favoritesContainer.innerHTML = '<p class="empty-favorites">No favorites yet</p>';
        return;
    }
    
    state.favorites.forEach(fav => {
        const favoriteItem = document.createElement('div');
        favoriteItem.className = 'favorite-item';
        
        favoriteItem.innerHTML = `
            <span class="favorite-item-name">${fav.name}</span>
            <i class="fas fa-times remove-favorite"></i>
        `;
        
        // Open repository when clicked
        favoriteItem.addEventListener('click', (e) => {
            if (!e.target.classList.contains('remove-favorite')) {
                window.open(fav.url, '_blank');
            }
        });
        
        // Remove from favorites
        favoriteItem.querySelector('.remove-favorite').addEventListener('click', (e) => {
            e.stopPropagation();
            removeFromFavorites({ id: fav.id });
        });
        
        favoritesContainer.appendChild(favoriteItem);
    });
}

// Show toast notification
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'times-circle';
    if (type === 'warning') icon = 'exclamation-triangle';
    
    toast.innerHTML = `
        <div class="toast-icon">
            <i class="fas fa-${icon}"></i>
        </div>
        <div class="toast-content">
            <div class="toast-message">${message}</div>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    // Remove toast after animation completes
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Generate related repository recommendations
function generateRecommendations(repositories) {
    if (!repositories) {
        repositories = Object.values(state.repoCache);
    }
    
    if (repositories.length === 0) return;
    
    // Create a list of all repositories that aren't already in the queue
    const availableRepos = repositories.filter(repo => 
        !state.recommendationQueue.some(queuedRepo => queuedRepo.id === repo.id)
    );
    
    // Add all available repos to the queue
    state.recommendationQueue = [...state.recommendationQueue, ...availableRepos];
    
    // If the queue was empty and we just added items, start showing recommendations
    if (!state.isPopupVisible && state.recommendationQueue.length > 0 && state.showRecommendations) {
        showNextRecommendation();
    }
}

// Show next repository recommendation
function showNextRecommendation() {
    if (!state.showRecommendations) return;
    
    // Check if we're rate limited
    if (apiTracker.isRateLimited()) {
        console.log('Skipping recommendations due to rate limiting');
        return;
    }
    
    if (state.recommendationQueue.length === 0) {
        // If we've shown all recommendations, regenerate from cache
        generateRecommendations();
        
        // If still empty, try to fetch more repositories
        if (state.recommendationQueue.length === 0) {
            return;
        }
    }
    
    // Track recommendations
    trackEvent('show_recommendation', {
        queue_length: state.recommendationQueue.length,
        frequency: state.recommendationFrequency
    });
    
    // Get the next recommendation
    const repo = state.recommendationQueue.shift();
    state.activeRepo = repo;
    
    // Generate tags for popup
    const tags = [];
    if (repo.language) {
        tags.push(repo.language);
    }
    if (repo.license && repo.license.name) {
        tags.push(repo.license.name);
    }
    if (repo.topics && repo.topics.length > 0) {
        tags.push(...repo.topics.slice(0, 2));
    }
    
    // Update popup content
    popupTitle.textContent = repo.full_name;
    popupDescription.textContent = repo.description || 'No description available';
    popupStats.innerHTML = `
        <div><i class="fas fa-star"></i> ${repo.stargazers_count.toLocaleString()} stars</div>
        <div><i class="fas fa-code-branch"></i> ${repo.forks_count.toLocaleString()} forks</div>
        <div><i class="fas fa-code"></i> ${repo.language || 'Not specified'}</div>
        <div><i class="fas fa-history"></i> Updated ${formatDate(repo.updated_at)}</div>
    `;
    popupTags.innerHTML = '';
    tags.forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = 'tag';
        tagEl.textContent = tag;
        popupTags.appendChild(tagEl);
    });
    
    viewRepoBtn.dataset.url = repo.html_url;
    
    // Check if in favorites and update button
    const isFavorite = state.favorites.some(fav => fav.id === repo.id);
    favoriteBtn.innerHTML = isFavorite
        ? '<i class="fas fa-heart"></i> Remove from Favorites'
        : '<i class="far fa-heart"></i> Add to Favorites';
    
    // Show the popup
    recommendationPopup.classList.remove('hidden');
    state.isPopupVisible = true;
    
    // Set a timeout to show the next recommendation
    state.currentPopupTimeout = setTimeout(() => {
        hideRecommendation();
        // Wait a bit before showing the next one
        setTimeout(showNextRecommendation, 2000);
    }, state.recommendationFrequency); // Show based on user preference
}

// Hide the recommendation popup
function hideRecommendation() {
    recommendationPopup.classList.add('hidden');
    state.isPopupVisible = false;
    
    // Clear the timeout if it exists
    if (state.currentPopupTimeout) {
        clearTimeout(state.currentPopupTimeout);
        state.currentPopupTimeout = null;
    }
}

// Start the recommendation cycle
function startRecommendationCycle() {
    // Start showing recommendations after a few seconds
    setTimeout(() => {
        if (state.showRecommendations) {
            if (state.recommendationQueue.length > 0) {
                showNextRecommendation();
            } else if (Object.keys(state.repoCache).length > 0) {
                generateRecommendations();
            }
        }
    }, 5000); // Start after 5 seconds
}