import React, { useState } from 'react';

// Sample data
const treasuryData = [
  { token: 'USDC', base: 125000, arbitrum: 85000, ethereum: 250000, polygon: 45000 },
  { token: 'USDT', base: 95000, arbitrum: 120000, ethereum: 180000, polygon: 60000 },
  { token: 'PYUSD', base: 50000, arbitrum: 35000, ethereum: 90000, polygon: 20000 },
  { token: 'DAI', base: 40000, arbitrum: 55000, ethereum: 110000, polygon: 25000 },
];

const chains = ['base', 'arbitrum', 'ethereum', 'polygon'];

const formatCurrency = (value) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const getTotal = (token) => {
  return Object.values(token).reduce((sum, val) => 
    typeof val === 'number' ? sum + val : sum, 0
  );
};

const getChainTotal = (chain) => {
  return treasuryData.reduce((sum, token) => sum + token[chain], 0);
};

// Pattern 1: Matrix Heatmap
const MatrixPattern = () => {
  const allValues = treasuryData.flatMap(t => chains.map(c => t[c]));
  const max = Math.max(...allValues);
  
  const getHeatColor = (value) => {
    const intensity = value / max;
    return `rgba(34, 197, 94, ${0.1 + intensity * 0.9})`;
  };
  
  return (
    <div style={{ padding: '40px', background: '#0a0a0b', minHeight: '100vh', fontFamily: 'IBM Plex Mono, monospace' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <h2 style={{ color: '#fff', fontSize: '28px', marginBottom: '8px', fontWeight: '600' }}>
          Matrix View
        </h2>
        <p style={{ color: '#666', marginBottom: '40px', fontSize: '14px' }}>
          Token × Chain heat map with instant visual comparison
        </p>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '140px repeat(4, 1fr)',
          gap: '2px',
          background: '#1a1a1d',
          padding: '2px',
          borderRadius: '12px',
          overflow: 'hidden'
        }}>
          {/* Header */}
          <div style={{ background: '#0a0a0b', padding: '20px' }}></div>
          {chains.map(chain => (
            <div key={chain} style={{ 
              background: '#0a0a0b', 
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}>
              <div style={{ 
                color: '#fff', 
                fontSize: '13px', 
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                {chain}
              </div>
              <div style={{ color: '#666', fontSize: '11px' }}>
                {formatCurrency(getChainTotal(chain))}
              </div>
            </div>
          ))}
          
          {/* Data rows */}
          {treasuryData.map(token => (
            <React.Fragment key={token.token}>
              <div style={{ 
                background: '#0a0a0b', 
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: '4px'
              }}>
                <div style={{ 
                  color: '#fff', 
                  fontSize: '15px', 
                  fontWeight: '600'
                }}>
                  {token.token}
                </div>
                <div style={{ color: '#666', fontSize: '11px' }}>
                  {formatCurrency(getTotal(token))}
                </div>
              </div>
              
              {chains.map(chain => (
                <div key={`${token.token}-${chain}`} style={{
                  background: getHeatColor(token[chain]),
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.zIndex = '10';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.zIndex = '1';
                }}
                >
                  <div style={{ color: '#22c55e', fontSize: '18px', fontWeight: '600' }}>
                    {formatCurrency(token[chain])}
                  </div>
                  <div style={{ 
                    color: '#666', 
                    fontSize: '10px',
                    opacity: token[chain] / max > 0.3 ? 1 : 0.5
                  }}>
                    {((token[chain] / getTotal(token)) * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

// Pattern 2: Nested Cards
const NestedCardsPattern = () => {
  return (
    <div style={{ 
      padding: '40px', 
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
      minHeight: '100vh',
      fontFamily: 'Outfit, sans-serif'
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <h2 style={{ color: '#fff', fontSize: '32px', marginBottom: '8px', fontWeight: '700' }}>
          Token-First View
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '40px', fontSize: '16px' }}>
          Organized by stablecoin with chains nested within
        </p>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '24px'
        }}>
          {treasuryData.map(token => (
            <div key={token.token} style={{
              background: 'rgba(255,255,255,0.95)',
              borderRadius: '20px',
              padding: '28px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,0.2)'
            }}>
              <div style={{ marginBottom: '24px' }}>
                <div style={{ 
                  fontSize: '28px', 
                  fontWeight: '700',
                  color: '#1a1a2e',
                  marginBottom: '4px'
                }}>
                  {token.token}
                </div>
                <div style={{ 
                  fontSize: '20px', 
                  color: '#667eea',
                  fontWeight: '600'
                }}>
                  {formatCurrency(getTotal(token))}
                </div>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {chains.map(chain => {
                  const percentage = (token[chain] / getTotal(token)) * 100;
                  return (
                    <div key={chain} style={{
                      background: 'linear-gradient(90deg, rgba(102,126,234,0.1) 0%, rgba(255,255,255,0) 100%)',
                      borderRadius: '12px',
                      padding: '16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      position: 'relative',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${percentage}%`,
                        background: 'linear-gradient(90deg, rgba(102,126,234,0.15) 0%, rgba(118,75,162,0.15) 100%)',
                        transition: 'width 0.3s ease',
                        borderRadius: '12px'
                      }}></div>
                      
                      <div style={{ position: 'relative', zIndex: 1 }}>
                        <div style={{ 
                          fontSize: '13px', 
                          fontWeight: '600',
                          color: '#666',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          marginBottom: '2px'
                        }}>
                          {chain}
                        </div>
                        <div style={{ fontSize: '11px', color: '#999' }}>
                          {percentage.toFixed(1)}% of total
                        </div>
                      </div>
                      
                      <div style={{ 
                        fontSize: '16px', 
                        fontWeight: '600',
                        color: '#1a1a2e',
                        position: 'relative',
                        zIndex: 1
                      }}>
                        {formatCurrency(token[chain])}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Pattern 3: Chain-First Cards
const ChainFirstPattern = () => {
  return (
    <div style={{ 
      padding: '40px', 
      background: '#f8fafc',
      minHeight: '100vh',
      fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <h2 style={{ color: '#0f172a', fontSize: '32px', marginBottom: '8px', fontWeight: '700' }}>
          Chain-First View
        </h2>
        <p style={{ color: '#64748b', marginBottom: '40px', fontSize: '16px' }}>
          Organized by blockchain with token breakdown
        </p>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '24px'
        }}>
          {chains.map(chain => {
            const chainTotal = getChainTotal(chain);
            return (
              <div key={chain} style={{
                background: '#fff',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ marginBottom: '20px', paddingBottom: '20px', borderBottom: '2px solid #e2e8f0' }}>
                  <div style={{ 
                    fontSize: '14px', 
                    fontWeight: '600',
                    color: '#64748b',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '8px'
                  }}>
                    {chain}
                  </div>
                  <div style={{ 
                    fontSize: '28px', 
                    color: '#0f172a',
                    fontWeight: '700'
                  }}>
                    {formatCurrency(chainTotal)}
                  </div>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {treasuryData.map(token => {
                    const percentage = (token[chain] / chainTotal) * 100;
                    return (
                      <div key={token.token} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 0'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                          <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: percentage > 25 ? '#10b981' : percentage > 15 ? '#3b82f6' : '#8b5cf6'
                          }}></div>
                          <div>
                            <div style={{ 
                              fontSize: '14px', 
                              fontWeight: '600',
                              color: '#0f172a',
                              marginBottom: '2px'
                            }}>
                              {token.token}
                            </div>
                            <div style={{
                              width: '100%',
                              height: '4px',
                              background: '#e2e8f0',
                              borderRadius: '2px',
                              overflow: 'hidden',
                              marginTop: '4px'
                            }}>
                              <div style={{
                                width: `${percentage}%`,
                                height: '100%',
                                background: percentage > 25 ? '#10b981' : percentage > 15 ? '#3b82f6' : '#8b5cf6',
                                transition: 'width 0.3s ease'
                              }}></div>
                            </div>
                          </div>
                        </div>
                        
                        <div style={{ textAlign: 'right', marginLeft: '16px' }}>
                          <div style={{ 
                            fontSize: '15px', 
                            fontWeight: '600',
                            color: '#0f172a'
                          }}>
                            {formatCurrency(token[chain])}
                          </div>
                          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                            {percentage.toFixed(0)}%
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// Pattern 4: Comparison Bars
const ComparisonBarsPattern = () => {
  const [viewMode, setViewMode] = React.useState('tokens'); // 'tokens' or 'chains'
  const grandTotal = treasuryData.reduce((sum, token) => sum + getTotal(token), 0);
  
  return (
    <div style={{ 
      padding: '40px', 
      background: '#1a1a1d',
      minHeight: '100vh',
      fontFamily: 'Space Grotesk, sans-serif'
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px' }}>
          <div>
            <h2 style={{ color: '#fff', fontSize: '32px', marginBottom: '8px', fontWeight: '700' }}>
              Visual Comparison
            </h2>
            <p style={{ color: '#888', fontSize: '16px' }}>
              {viewMode === 'tokens' ? 'Token distribution across chains' : 'Chain distribution across tokens'}
            </p>
          </div>
          
          {/* Toggle Switch */}
          <div style={{
            background: '#0f0f10',
            border: '1px solid #2a2a2d',
            borderRadius: '12px',
            padding: '6px',
            display: 'flex',
            gap: '6px'
          }}>
            <button
              onClick={() => setViewMode('tokens')}
              style={{
                padding: '10px 20px',
                background: viewMode === 'tokens' ? '#00ff88' : 'transparent',
                color: viewMode === 'tokens' ? '#000' : '#888',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                transition: 'all 0.2s',
                fontFamily: 'inherit'
              }}
            >
              By Token
            </button>
            <button
              onClick={() => setViewMode('chains')}
              style={{
                padding: '10px 20px',
                background: viewMode === 'chains' ? '#00ff88' : 'transparent',
                color: viewMode === 'chains' ? '#000' : '#888',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                transition: 'all 0.2s',
                fontFamily: 'inherit'
              }}
            >
              By Chain
            </button>
          </div>
        </div>
        
        <div style={{ 
          background: '#0f0f10',
          borderRadius: '20px',
          padding: '32px',
          marginBottom: '32px'
        }}>
          <div style={{ fontSize: '14px', color: '#888', marginBottom: '8px' }}>
            Total Treasury Value
          </div>
          <div style={{ fontSize: '48px', fontWeight: '700', color: '#fff' }}>
            {formatCurrency(grandTotal)}
          </div>
        </div>
        
        {viewMode === 'tokens' ? (
          // Token view - sections are tokens, bars show chain distribution
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            {treasuryData.map(token => {
              const tokenTotal = getTotal(token);
              const tokenPercentage = (tokenTotal / grandTotal) * 100;
              
              return (
                <div key={token.token} style={{
                  background: '#0f0f10',
                  borderRadius: '16px',
                  padding: '24px',
                  border: '1px solid #2a2a2d'
                }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '16px'
                  }}>
                    <div>
                      <div style={{ 
                        fontSize: '24px', 
                        fontWeight: '700',
                        color: '#fff',
                        marginBottom: '4px'
                      }}>
                        {token.token}
                      </div>
                      <div style={{ fontSize: '14px', color: '#888' }}>
                        {tokenPercentage.toFixed(1)}% of total treasury
                      </div>
                    </div>
                    <div style={{ 
                      fontSize: '28px', 
                      fontWeight: '700',
                      color: '#00ff88'
                    }}>
                      {formatCurrency(tokenTotal)}
                    </div>
                  </div>
                  
                  <div style={{ 
                    display: 'flex', 
                    gap: '4px',
                    height: '60px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    background: '#1a1a1d'
                  }}>
                    {chains.map((chain, idx) => {
                      const percentage = (token[chain] / tokenTotal) * 100;
                      const colors = ['#00ff88', '#00d4ff', '#ff00ff', '#ffaa00'];
                      
                      return (
                        <div key={chain} style={{
                          width: `${percentage}%`,
                          background: colors[idx],
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                          transition: 'all 0.3s ease',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'scaleY(1.1)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scaleY(1)';
                        }}
                        >
                          {percentage > 15 && (
                            <>
                              <div style={{ 
                                fontSize: '11px', 
                                fontWeight: '600',
                                color: '#000',
                                textTransform: 'uppercase',
                                marginBottom: '2px'
                              }}>
                                {chain}
                              </div>
                              <div style={{ fontSize: '13px', fontWeight: '700', color: '#000' }}>
                                {formatCurrency(token[chain])}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    marginTop: '12px',
                    fontSize: '12px',
                    color: '#666'
                  }}>
                    {chains.map((chain, idx) => {
                      const colors = ['#00ff88', '#00d4ff', '#ff00ff', '#ffaa00'];
                      return (
                        <div key={chain} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '2px',
                            background: colors[idx]
                          }}></div>
                          <span style={{ textTransform: 'uppercase', fontSize: '10px' }}>
                            {chain}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // Chain view - sections are chains, bars show token distribution
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            {chains.map((chain, chainIdx) => {
              const chainTotal = getChainTotal(chain);
              const chainPercentage = (chainTotal / grandTotal) * 100;
              const colors = ['#00ff88', '#00d4ff', '#ff00ff', '#ffaa00'];
              
              return (
                <div key={chain} style={{
                  background: '#0f0f10',
                  borderRadius: '16px',
                  padding: '24px',
                  border: '1px solid #2a2a2d'
                }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '16px'
                  }}>
                    <div>
                      <div style={{ 
                        fontSize: '24px', 
                        fontWeight: '700',
                        color: '#fff',
                        marginBottom: '4px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        {chain}
                      </div>
                      <div style={{ fontSize: '14px', color: '#888' }}>
                        {chainPercentage.toFixed(1)}% of total treasury
                      </div>
                    </div>
                    <div style={{ 
                      fontSize: '28px', 
                      fontWeight: '700',
                      color: colors[chainIdx]
                    }}>
                      {formatCurrency(chainTotal)}
                    </div>
                  </div>
                  
                  <div style={{ 
                    display: 'flex', 
                    gap: '4px',
                    height: '60px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    background: '#1a1a1d'
                  }}>
                    {treasuryData.map((token) => {
                      const percentage = (token[chain] / chainTotal) * 100;
                      const tokenColors = {
                        'USDC': '#2775ca',
                        'USDT': '#26a17b',
                        'PYUSD': '#0042ff',
                        'DAI': '#f4b731'
                      };
                      
                      return (
                        <div key={token.token} style={{
                          width: `${percentage}%`,
                          background: tokenColors[token.token] || '#888',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                          transition: 'all 0.3s ease',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'scaleY(1.1)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scaleY(1)';
                        }}
                        >
                          {percentage > 15 && (
                            <>
                              <div style={{ 
                                fontSize: '11px', 
                                fontWeight: '600',
                                color: '#fff',
                                marginBottom: '2px'
                              }}>
                                {token.token}
                              </div>
                              <div style={{ fontSize: '13px', fontWeight: '700', color: '#fff' }}>
                                {formatCurrency(token[chain])}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    marginTop: '12px',
                    fontSize: '12px',
                    color: '#666'
                  }}>
                    {treasuryData.map((token) => {
                      const tokenColors = {
                        'USDC': '#2775ca',
                        'USDT': '#26a17b',
                        'PYUSD': '#0042ff',
                        'DAI': '#f4b731'
                      };
                      return (
                        <div key={token.token} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '2px',
                            background: tokenColors[token.token] || '#888'
                          }}></div>
                          <span style={{ fontSize: '10px' }}>
                            {token.token}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// Main App
export default function TreasuryMockups() {
  const [activePattern, setActivePattern] = useState('matrix');
  
  const patterns = [
    { id: 'matrix', name: 'Matrix Heatmap', component: MatrixPattern },
    { id: 'nested', name: 'Token-First Cards', component: NestedCardsPattern },
    { id: 'chain', name: 'Chain-First Cards', component: ChainFirstPattern },
    { id: 'comparison', name: 'Visual Comparison', component: ComparisonBarsPattern }
  ];
  
  const ActiveComponent = patterns.find(p => p.id === activePattern).component;
  
  return (
    <div style={{ position: 'relative' }}>
      {/* Navigation */}
      <div style={{
        position: 'fixed',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: 'rgba(0,0,0,0.9)',
        backdropFilter: 'blur(10px)',
        borderRadius: '16px',
        padding: '8px',
        display: 'flex',
        gap: '8px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.1)'
      }}>
        {patterns.map(pattern => (
          <button
            key={pattern.id}
            onClick={() => setActivePattern(pattern.id)}
            style={{
              padding: '12px 24px',
              background: activePattern === pattern.id ? '#fff' : 'transparent',
              color: activePattern === pattern.id ? '#000' : '#fff',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '600',
              transition: 'all 0.2s',
              fontFamily: 'inherit'
            }}
          >
            {pattern.name}
          </button>
        ))}
      </div>
      
      {/* Active Pattern */}
      <ActiveComponent />
    </div>
  );
}
